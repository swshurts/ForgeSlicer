/**
 * sceneDiff — compare a "committed" scene against a "proposed" one and
 * summarise the changes for the proposal-review UI (iter-151.14).
 *
 * We produce three buckets keyed by object id:
 *   added:    id present only in proposed
 *   removed:  id present only in committed
 *   changed:  id present in both, but shape / position / rotation /
 *             scale / dims differs
 *
 * Comparison is intentionally deep-ish but coarse — we round positions
 * to 0.01 mm and rotations to 0.001 rad so that pure floating-point
 * noise (e.g. a re-import round-tripping through JSON) does not create
 * a false-positive change.
 */

const POS_EPS = 0.01;
const ROT_EPS = 0.001;
const SCALE_EPS = 0.001;

function approxEq(a, b, eps) {
  return Math.abs((a ?? 0) - (b ?? 0)) <= eps;
}

function arrEq(a, b, eps) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((v, i) => approxEq(v, b[i], eps));
}

function dimsEq(a, b) {
  // Dims can be an object of numeric keys (x/y/z/r/…). Return false if
  // any numeric value differs by more than 0.01.
  const ka = Object.keys(a || {});
  const kb = Object.keys(b || {});
  const keys = new Set([...ka, ...kb]);
  for (const k of keys) {
    const va = a?.[k];
    const vb = b?.[k];
    if (typeof va === "number" && typeof vb === "number") {
      if (!approxEq(va, vb, POS_EPS)) return false;
    } else if (JSON.stringify(va) !== JSON.stringify(vb)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} committed  the project's current committed scene
 * @param {object} proposed   the proposal's scene snapshot
 * @returns {{ added: object[], removed: object[], changed: object[],
 *            totals: {committed: number, proposed: number} }}
 */
export function sceneDiff(committed, proposed) {
  const a = (committed?.objects || []);
  const b = (proposed?.objects || []);
  const aById = new Map(a.map((o) => [o.id, o]));
  const bById = new Map(b.map((o) => [o.id, o]));
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, ob] of bById) {
    if (!aById.has(id)) { added.push(ob); continue; }
    const oa = aById.get(id);
    const posEq = arrEq(oa.position, ob.position, POS_EPS);
    const rotEq = arrEq(oa.rotation, ob.rotation, ROT_EPS);
    const scaleEq = arrEq(oa.scale, ob.scale, SCALE_EPS);
    const typeEq = oa.type === ob.type;
    const dimsOk = dimsEq(oa.dims, ob.dims);
    const nameEq = (oa.name || "") === (ob.name || "");
    const plateEq = (oa.plateId || "plate-1") === (ob.plateId || "plate-1");
    const visEq = (oa.visible !== false) === (ob.visible !== false);
    if (!(posEq && rotEq && scaleEq && typeEq && dimsOk && nameEq && plateEq && visEq)) {
      changed.push({
        before: oa,
        after: ob,
        // Human-readable list of what specifically differs.
        fields: [
          !typeEq && "type",
          !nameEq && "name",
          !posEq && "position",
          !rotEq && "rotation",
          !scaleEq && "scale",
          !dimsOk && "dims",
          !plateEq && "plate",
          !visEq && "visible",
        ].filter(Boolean),
      });
    }
  }
  for (const [id, oa] of aById) {
    if (!bById.has(id)) removed.push(oa);
  }
  return {
    added, removed, changed,
    totals: { committed: a.length, proposed: b.length },
  };
}

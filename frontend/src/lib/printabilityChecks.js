// Pure printability checks. NO React, NO Zustand — each function takes
// plain data and returns Finding[] so the suite can run in a worker
// later if needed. iter-108.x ships Check #1 (non-manifold / open
// geometry); the remaining six checks land on top of this same
// scaffolding.

const SEV_FAIL = "will-fail";
const SEV_LIKELY = "likely-fail";

/** O(triangles) topology scan. Returns counts of open edges, T-junctions,
 *  flipped-normal candidates, and an Float32Array of line-segment
 *  positions for the offending edges (clipped to <= 5000 segs so very
 *  large meshes don't melt the viewport). */
function scanEdgeTopology(vertices, indices, MAX_HIGHLIGHT = 5000) {
    const edgeCount = new Map(); // canonical "a:b" → count
    const edgeSign = new Map();  // canonical "a:b" → sum of half-edge directions (detects same-side double-share)
    const offendingKeys = [];

    const n = indices ? indices.length : (vertices.length / 3);
    const get = (i) => indices ? indices[i] : i;

    for (let t = 0; t < n; t += 3) {
        const a = get(t), b = get(t + 1), c = get(t + 2);
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const lo = Math.min(u, v), hi = Math.max(u, v);
            if (lo === hi) continue; // degenerate
            const key = `${lo}:${hi}`;
            edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            const dir = u < v ? +1 : -1;
            edgeSign.set(key, (edgeSign.get(key) || 0) + dir);
        }
    }

    let openEdges = 0, tJunctions = 0, flippedNormals = 0;
    for (const [key, count] of edgeCount) {
        if (count === 1) {
            openEdges++;
            if (offendingKeys.length < MAX_HIGHLIGHT) offendingKeys.push(key);
        } else if (count >= 3) {
            tJunctions++;
            if (offendingKeys.length < MAX_HIGHLIGHT) offendingKeys.push(key);
        } else if (count === 2 && Math.abs(edgeSign.get(key)) === 2) {
            // Both shares went the SAME direction → one of the two
            // triangles has a flipped winding (consistent mesh has
            // dir-sum = 0 on every interior edge).
            flippedNormals++;
            if (offendingKeys.length < MAX_HIGHLIGHT) offendingKeys.push(key);
        }
    }

    // Build line-segment positions for the highlight overlay.
    const segs = new Float32Array(offendingKeys.length * 6);
    let si = 0;
    for (const key of offendingKeys) {
        const [lo, hi] = key.split(":").map(Number);
        segs[si++] = vertices[lo * 3];
        segs[si++] = vertices[lo * 3 + 1];
        segs[si++] = vertices[lo * 3 + 2];
        segs[si++] = vertices[hi * 3];
        segs[si++] = vertices[hi * 3 + 1];
        segs[si++] = vertices[hi * 3 + 2];
    }

    return {
        openEdges,
        tJunctions,
        flippedNormals,
        totalEdges: edgeCount.size,
        highlightPositions: segs,
        truncated: offendingKeys.length >= MAX_HIGHLIGHT,
    };
}

/** Check #1 — non-manifold / open geometry. Only runs on imported
 *  meshes (parametric / composite objects are manifold by construction
 *  via the Manifold-3D booleans). Returns 0 or 1 Finding per object. */
const MAX_HIGHLIGHT_SEGS = 5000;
export function checkNonManifold(obj) {
    if (!obj || obj.type !== "imported" || !obj.geometry) return null;
    const v = obj.geometry.vertices;
    const i = obj.geometry.indices;
    if (!v || v.length === 0) return null;

    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const r = scanEdgeTopology(v, i, MAX_HIGHLIGHT_SEGS);
    const dt = ((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) | 0;

    const hardFault = r.openEdges > 0 || r.tJunctions > 0;
    const softFault = r.flippedNormals > 0;
    if (!hardFault && !softFault) return null;

    const severity = hardFault ? SEV_FAIL : SEV_LIKELY;
    const title = hardFault
        ? "Your model has gaps the slicer can't seal."
        : "Some faces are flipped inside-out — the slicer may print this hollow.";
    const bits = [];
    if (r.openEdges > 0) bits.push(`${r.openEdges} open edge${r.openEdges === 1 ? "" : "s"}`);
    if (r.tJunctions > 0) bits.push(`${r.tJunctions} T-junction${r.tJunctions === 1 ? "" : "s"}`);
    if (r.flippedNormals > 0) bits.push(`${r.flippedNormals} flipped-normal candidate${r.flippedNormals === 1 ? "" : "s"}`);
    const technicalDetail =
        `${bits.join(" · ")} across ${r.totalEdges} edges` +
        (r.truncated ? ` (highlight clipped to ${MAX_HIGHLIGHT_SEGS} segs)` : "") +
        ` · scan ${dt} ms`;

    return {
        id: `non-manifold-${obj.id}`,
        checkId: "non-manifold",
        severity,
        title,
        technicalDetail,
        affectedObjectIds: [obj.id],
        affectedObjectName: obj.name || "Imported mesh",
        highlight: { type: "edges", positions: r.highlightPositions },
        fixes: hardFault
            ? [
                { id: "repair", label: "Repair mesh", primary: true, kind: "action" },
                { id: "silence", label: "Mark as OK — I know what I'm doing", kind: "silence" },
            ]
            : [
                { id: "silence", label: "Mark as OK — I know what I'm doing", kind: "silence", primary: true },
            ],
    };
}

/** Run every implemented check across the scene. Future check
 *  functions just get appended to CHECKS — the panel and store don't
 *  need to know about them individually. */
const CHECKS = [checkNonManifold];

export function runAllChecks(scene) {
    const findings = [];
    const objects = scene?.objects || [];
    for (const obj of objects) {
        for (const check of CHECKS) {
            const f = check(obj, scene);
            if (f) findings.push(f);
        }
    }
    return findings;
}

/** Order by severity so the "Will fail" rows always sit on top. */
export const SEVERITY_RANK = { "will-fail": 0, "likely-fail": 1, "quality": 2, "ok": 3 };
export function sortBySeverity(findings) {
    return [...findings].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
}

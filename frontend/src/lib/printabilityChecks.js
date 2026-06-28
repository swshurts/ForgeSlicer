// Pure printability checks. NO React, NO Zustand — each function takes
// plain data and returns a Finding (or null), so the suite can run in
// a worker later if needed.
//
// iter-108  shipped Check #1 (non-manifold / open geometry).
// iter-109  ships Checks #2-#7:
//     #2 Thin walls (raycast medial-axis scan, async)
//     #3 Overhangs (face-normal vs +Z)
//     #4 Floating parts (object bbox.min.z > tolerance)
//     #5 Intersecting geometry (pairwise AABB overlap on positives)
//     #6 Build-volume violations (world bbox vs scene.buildVolume)
//     #7 Very small features (bbox shortest dim < 0.6 mm, or imported edges)
//
// Each check is a pure function of (obj, scene) for per-object checks
// or (scene) for scene-level checks. The `CHECKS` table at the bottom
// registers them — adding a new check is one append + one function.

import * as THREE from "three";
import { computeRotatedBBox, buildGeometry } from "./geometry";

const SEV_FAIL = "will-fail";
const SEV_LIKELY = "likely-fail";
const SEV_QUALITY = "quality";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const THIN_WALL_MM = 0.8;            // < 2 × nominal 0.4 nozzle
const SMALL_FEATURE_MM = 0.6;        // < 1.5 × nozzle — won't render reliably
const OVERHANG_ANGLE_DEG = 45;       // OrcaSlicer default support angle
const OVERHANG_AREA_FRACTION = 0.05; // > 5% overhanging triangle area flags
const FLOAT_TOL_MM = 0.1;            // bbox.min.z above bed by this much = floating
const INTERSECT_OVERLAP_MM = 0.2;    // AABB overlap larger than this on every axis = real
const MAX_HIGHLIGHT_SEGS = 5000;     // cap highlight buffers

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function worldBBox(obj) {
    try {
        const bb = computeRotatedBBox(obj);
        const px = obj.position?.[0] ?? 0;
        const py = obj.position?.[1] ?? 0;
        const pz = obj.position?.[2] ?? 0;
        return {
            min: { x: px + bb.min.x, y: py + bb.min.y, z: pz + bb.min.z },
            max: { x: px + bb.max.x, y: py + bb.max.y, z: pz + bb.max.z },
        };
    } catch { return null; }
}

function worldSize(bb) {
    return {
        x: bb.max.x - bb.min.x,
        y: bb.max.y - bb.min.y,
        z: bb.max.z - bb.min.z,
    };
}

function isPrintable(obj) {
    if (!obj) return false;
    if (obj.visible === false) return false;
    if (obj.modifier === "negative") return false;
    if (obj.type === "sketch" || obj.type === "spline") return false;
    return true;
}

function aabbsOverlap(a, b, eps = INTERSECT_OVERLAP_MM) {
    return (
        Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) > eps &&
        Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y) > eps &&
        Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z) > eps
    );
}

/** Build a unit-scale world-space BufferGeometry for `obj`. Includes
 *  rotation + scale + translation so positions are in scene-world mm. */
function worldGeometry(obj) {
    const g = buildGeometry(obj);
    const rot = obj.rotation || [0, 0, 0];
    const sc = obj.scale || [1, 1, 1];
    const pos = obj.position || [0, 0, 0];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(rot[0]),
        THREE.MathUtils.degToRad(rot[1]),
        THREE.MathUtils.degToRad(rot[2]),
    ));
    m.compose(new THREE.Vector3(pos[0], pos[1], pos[2]), q,
              new THREE.Vector3(sc[0], sc[1], sc[2]));
    g.applyMatrix4(m);
    g.computeVertexNormals();
    return g;
}

// ---------------------------------------------------------------------------
// Check #1 — Non-manifold / open geometry  (sync, imported only)
// ---------------------------------------------------------------------------

function scanEdgeTopology(vertices, indices) {
    const edgeCount = new Map();
    const edgeSign = new Map();
    const offendingKeys = [];

    const n = indices ? indices.length : (vertices.length / 3);
    const get = (i) => indices ? indices[i] : i;

    for (let t = 0; t < n; t += 3) {
        const a = get(t), b = get(t + 1), c = get(t + 2);
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
            const lo = Math.min(u, v), hi = Math.max(u, v);
            if (lo === hi) continue;
            const key = `${lo}:${hi}`;
            edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
            edgeSign.set(key, (edgeSign.get(key) || 0) + (u < v ? +1 : -1));
        }
    }

    let openEdges = 0, tJunctions = 0, flippedNormals = 0;
    for (const [key, count] of edgeCount) {
        if (count === 1) { openEdges++; if (offendingKeys.length < MAX_HIGHLIGHT_SEGS) offendingKeys.push(key); }
        else if (count >= 3) { tJunctions++; if (offendingKeys.length < MAX_HIGHLIGHT_SEGS) offendingKeys.push(key); }
        else if (count === 2 && Math.abs(edgeSign.get(key)) === 2) {
            flippedNormals++;
            if (offendingKeys.length < MAX_HIGHLIGHT_SEGS) offendingKeys.push(key);
        }
    }

    const segs = new Float32Array(offendingKeys.length * 6);
    let si = 0;
    for (const key of offendingKeys) {
        const [lo, hi] = key.split(":").map(Number);
        segs[si++] = vertices[lo * 3];     segs[si++] = vertices[lo * 3 + 1]; segs[si++] = vertices[lo * 3 + 2];
        segs[si++] = vertices[hi * 3];     segs[si++] = vertices[hi * 3 + 1]; segs[si++] = vertices[hi * 3 + 2];
    }

    return { openEdges, tJunctions, flippedNormals, totalEdges: edgeCount.size,
             highlightPositions: segs, truncated: offendingKeys.length >= MAX_HIGHLIGHT_SEGS };
}

export function checkNonManifold(obj) {
    if (!obj || obj.type !== "imported" || !obj.geometry) return null;
    const v = obj.geometry.vertices;
    const i = obj.geometry.indices;
    if (!v || v.length === 0) return null;

    const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const r = scanEdgeTopology(v, i);
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

    return {
        id: `non-manifold-${obj.id}`,
        checkId: "non-manifold",
        severity,
        title,
        technicalDetail: `${bits.join(" · ")} across ${r.totalEdges} edges` +
            (r.truncated ? ` (highlight clipped to ${MAX_HIGHLIGHT_SEGS} segs)` : "") +
            ` · scan ${dt} ms`,
        affectedObjectIds: [obj.id],
        affectedObjectName: obj.name || "Imported mesh",
        highlight: { type: "edges", positions: r.highlightPositions },
        fixes: hardFault
            ? [{ id: "repair",  label: "Repair mesh", primary: true, kind: "action" },
               { id: "silence", label: "Mark as OK — I know what I'm doing", kind: "silence" }]
            : [{ id: "silence", label: "Mark as OK — I know what I'm doing", kind: "silence", primary: true }],
    };
}

// ---------------------------------------------------------------------------
// Check #3 — Overhangs  (per-object, sync)
// ---------------------------------------------------------------------------

export function checkOverhangs(obj) {
    if (!isPrintable(obj)) return null;
    let g;
    try { g = worldGeometry(obj); } catch { return null; }
    try {
        const pos = g.getAttribute("position");
        const idx = g.index;
        const n = idx ? idx.count : pos.count;
        const get = (i) => idx ? idx.getX(i) : i;

        const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
        const ab = new THREE.Vector3(), ac = new THREE.Vector3(), cross = new THREE.Vector3();

        let totalArea = 0;
        let overhangArea = 0;
        const cosLimit = Math.cos(THREE.MathUtils.degToRad(180 - OVERHANG_ANGLE_DEG)); // normal pointing "down"
        const overhangSegs = [];

        for (let t = 0; t < n; t += 3) {
            va.fromBufferAttribute(pos, get(t));
            vb.fromBufferAttribute(pos, get(t + 1));
            vc.fromBufferAttribute(pos, get(t + 2));
            ab.subVectors(vb, va);
            ac.subVectors(vc, va);
            cross.crossVectors(ab, ac);
            const triArea = cross.length() * 0.5;
            if (triArea < 1e-6) continue;
            const nz = cross.z / (triArea * 2); // unit-normal z component
            totalArea += triArea;
            // Triangle counts as overhanging when its outward normal
            // points "down" (toward the bed) past the configured angle.
            // We also skip triangles whose lowest vertex is essentially
            // on the bed — those are the model's bottom face, not an
            // unsupported overhang.
            if (nz < cosLimit) {
                const lowestZ = Math.min(va.z, vb.z, vc.z);
                if (lowestZ > FLOAT_TOL_MM) {
                    overhangArea += triArea;
                    if (overhangSegs.length < MAX_HIGHLIGHT_SEGS * 6) {
                        overhangSegs.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
                        overhangSegs.push(vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
                        overhangSegs.push(vc.x, vc.y, vc.z, va.x, va.y, va.z);
                    }
                }
            }
        }
        g.dispose();

        const fraction = totalArea > 0 ? overhangArea / totalArea : 0;
        if (fraction < OVERHANG_AREA_FRACTION) return null;

        const pct = Math.round(fraction * 100);
        const severity = fraction > 0.25 ? SEV_LIKELY : SEV_QUALITY;
        return {
            id: `overhangs-${obj.id}`,
            checkId: "overhangs",
            severity,
            title: `Steep overhangs detected — the slicer will need supports.`,
            technicalDetail: `${pct}% of triangle area faces > ${OVERHANG_ANGLE_DEG}° downward · enable supports in your slicer or reorient the part to put the flat side on the bed.`,
            affectedObjectIds: [obj.id],
            affectedObjectName: obj.name || obj.type || "Part",
            highlight: { type: "edges", positions: new Float32Array(overhangSegs) },
            fixes: [
                { id: "auto-orient", label: "Auto-orient flat side down", primary: true, kind: "action" },
                { id: "silence",     label: "I'll add supports in the slicer", kind: "silence" },
            ],
        };
    } catch (e) {
        try { g?.dispose(); } catch { /* noop */ }
        return null;
    }
}

// ---------------------------------------------------------------------------
// Check #4 — Floating parts  (per-object, sync)
// ---------------------------------------------------------------------------

export function checkFloatingParts(obj) {
    if (!isPrintable(obj)) return null;
    const bb = worldBBox(obj);
    if (!bb) return null;
    if (bb.min.z <= FLOAT_TOL_MM) return null;
    const gap = bb.min.z;
    return {
        id: `floating-${obj.id}`,
        checkId: "floating",
        severity: SEV_FAIL,
        title: `"${obj.name || obj.type || "Part"}" floats ${gap.toFixed(2)} mm above the bed.`,
        technicalDetail: `The slicer prints layer-by-layer from the bed up — anything floating will fall when the first layer fails. Drop it to the bed or add a support tower.`,
        affectedObjectIds: [obj.id],
        affectedObjectName: obj.name || obj.type || "Part",
        highlight: null,
        fixes: [
            { id: "drop-to-bed", label: "Drop to bed",  primary: true, kind: "action" },
            { id: "silence",     label: "It's a multi-part assembly — keep position", kind: "silence" },
        ],
    };
}

// ---------------------------------------------------------------------------
// Check #6 — Build-volume violations  (per-object, sync)
// ---------------------------------------------------------------------------

export function checkBuildVolume(obj, scene) {
    if (!isPrintable(obj)) return null;
    const bv = scene?.buildVolume;
    if (!bv) return null;
    const bb = worldBBox(obj);
    if (!bb) return null;
    const size = worldSize(bb);

    // Compare against the full build volume (Z-up: bv.x/y/z map 1:1).
    const overX = Math.max(0, size.x - bv.x);
    const overY = Math.max(0, size.y - bv.y);
    const overZ = Math.max(0, size.z - bv.z);

    // Also flag a part that's outside the bed footprint even if it's
    // small enough — bb.max.x > bv.x/2 (printer origin = bed centre on
    // bedX) means it'd be shoved off the edge.
    const halfX = bv.x / 2, halfY = bv.y / 2;
    const outsideX = bb.max.x > halfX + 0.5 || bb.min.x < -halfX - 0.5;
    const outsideY = bb.max.y > halfY + 0.5 || bb.min.y < -halfY - 0.5;
    const outsideZ = bb.max.z > bv.z + 0.5;

    if (overX <= 0.05 && overY <= 0.05 && overZ <= 0.05 && !outsideX && !outsideY && !outsideZ) {
        return null;
    }

    const bits = [];
    if (overX > 0.05) bits.push(`${overX.toFixed(1)} mm too wide`);
    if (overY > 0.05) bits.push(`${overY.toFixed(1)} mm too deep`);
    if (overZ > 0.05) bits.push(`${overZ.toFixed(1)} mm too tall`);
    if (!bits.length) bits.push("positioned off the bed footprint");

    return {
        id: `buildvol-${obj.id}`,
        checkId: "build-volume",
        severity: SEV_FAIL,
        title: `"${obj.name || obj.type || "Part"}" doesn't fit your printer.`,
        technicalDetail: `${bits.join(" · ")}. Bed: ${bv.x}×${bv.y}×${bv.z} mm. Scale it down, switch to a bigger printer, or use Cut to split the part.`,
        affectedObjectIds: [obj.id],
        affectedObjectName: obj.name || obj.type || "Part",
        highlight: null,
        fixes: [
            { id: "scale-to-fit", label: "Scale scene to fit", primary: true, kind: "action" },
            { id: "silence",       label: "Mark as OK — I'll split it manually", kind: "silence" },
        ],
    };
}

// ---------------------------------------------------------------------------
// Check #7 — Very small features  (per-object, sync)
// ---------------------------------------------------------------------------

export function checkSmallFeatures(obj) {
    if (!isPrintable(obj)) return null;
    const bb = worldBBox(obj);
    if (!bb) return null;
    const s = worldSize(bb);
    const shortest = Math.min(s.x, s.y, s.z);
    if (shortest >= SMALL_FEATURE_MM) return null;

    return {
        id: `small-feature-${obj.id}`,
        checkId: "small-feature",
        severity: SEV_LIKELY,
        title: `"${obj.name || obj.type || "Part"}" is too thin to print reliably.`,
        technicalDetail: `Shortest dimension is ${shortest.toFixed(2)} mm — under ${SMALL_FEATURE_MM} mm typically prints as a blob or skips entirely on a 0.4 mm nozzle. Scale up or use a 0.2 mm nozzle.`,
        affectedObjectIds: [obj.id],
        affectedObjectName: obj.name || obj.type || "Part",
        highlight: null,
        fixes: [
            { id: "scale-up", label: "Scale up to 1 mm minimum", primary: true, kind: "action" },
            { id: "silence",  label: "I'm using a fine nozzle", kind: "silence" },
        ],
    };
}

// ---------------------------------------------------------------------------
// Check #5 — Intersecting geometry  (scene-level, sync)
// ---------------------------------------------------------------------------

export function checkIntersections(scene) {
    const out = [];
    const positives = (scene?.objects || []).filter((o) => isPrintable(o) && o.modifier !== "negative");
    if (positives.length < 2) return out;

    const bbs = positives.map((o) => ({ obj: o, bb: worldBBox(o) })).filter((x) => x.bb);

    for (let i = 0; i < bbs.length; i++) {
        for (let j = i + 1; j < bbs.length; j++) {
            if (!aabbsOverlap(bbs[i].bb, bbs[j].bb)) continue;
            const a = bbs[i].obj, b = bbs[j].obj;
            const aName = a.name || a.type || "Part";
            const bName = b.name || b.type || "Part";
            out.push({
                id: `intersect-${a.id}-${b.id}`,
                checkId: "intersect",
                severity: SEV_LIKELY,
                title: `"${aName}" overlaps "${bName}".`,
                technicalDetail: `Two positive parts share a volume — the slicer will print double-walled internal faces, which usually warps or jams. Union them, or move one part apart.`,
                affectedObjectIds: [a.id, b.id],
                affectedObjectName: `${aName} ↔ ${bName}`,
                highlight: null,
                fixes: [
                    { id: "select-pair", label: "Select both to union", primary: true, kind: "action" },
                    { id: "silence",      label: "It's intentional — keep both", kind: "silence" },
                ],
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Check #2 — Thin walls  (per-object, ASYNC — invoked from store via
// the thin-wall scanner). The synchronous CHECKS array does NOT
// include thin-walls; the store calls `scanThinWallsAsync` after the
// sync pass completes so the user sees a quick green panel first.
// ---------------------------------------------------------------------------

export async function scanThinWallsAsync(obj, opts = {}) {
    if (!isPrintable(obj)) return null;
    const threshold = opts.threshold ?? THIN_WALL_MM;
    const maxSamples = opts.maxSamples ?? 600;

    // three-mesh-bvh ships as ES modules; dynamic import keeps the
    // dep out of the slice/CSG worker bundle, and lets the main
    // bundle code-split it lazily on first scan.
    let MeshBVH;
    try {
        ({ MeshBVH } = await import("three-mesh-bvh"));
    } catch { return null; }

    let g;
    try { g = worldGeometry(obj); } catch { return null; }
    try {
        const pos = g.getAttribute("position");
        if (!g.index) {
            // BVH needs an indexed geometry; rebuild a trivial 0..N index.
            const n = pos.count;
            const arr = (n < 65536) ? new Uint16Array(n) : new Uint32Array(n);
            for (let i = 0; i < n; i++) arr[i] = i;
            g.setIndex(new THREE.BufferAttribute(arr, 1));
        }
        const bvh = new MeshBVH(g);
        // Sample N triangles uniformly across the index buffer. For
        // typical < 50k tri meshes maxSamples=600 means ~80x speedup
        // versus a per-triangle scan with no noticeable accuracy
        // loss for this "is anything paper-thin" question.
        const triCount = g.index.count / 3;
        const stride = Math.max(1, Math.floor(triCount / maxSamples));
        const idx = g.index;
        const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
        const ab = new THREE.Vector3(), ac = new THREE.Vector3(), normal = new THREE.Vector3();
        const center = new THREE.Vector3();
        const ray = new THREE.Ray();
        const hit = { point: new THREE.Vector3(), distance: 0, face: null, faceIndex: -1 };

        let sampled = 0;
        let thin = 0;
        const thinSegs = [];

        const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
        for (let t = 0; t < triCount; t += stride) {
            const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
            va.fromBufferAttribute(pos, a);
            vb.fromBufferAttribute(pos, b);
            vc.fromBufferAttribute(pos, c);
            ab.subVectors(vb, va);
            ac.subVectors(vc, va);
            normal.crossVectors(ab, ac);
            if (normal.lengthSq() < 1e-12) continue;
            normal.normalize();
            center.set((va.x + vb.x + vc.x) / 3, (va.y + vb.y + vc.y) / 3, (va.z + vb.z + vc.z) / 3);

            // Step inward off the source triangle, then raycast in the
            // -normal direction. The 1e-3 mm offset prevents the ray
            // from immediately re-hitting the source face.
            ray.origin.copy(center).addScaledVector(normal, -1e-3);
            ray.direction.copy(normal).negate();
            sampled++;

            // raycastFirst returns null when no hit, or a faceIndex-bearing
            // hit object. Hit.point - ray.origin = hit distance vector.
            const h = bvh.raycastFirst(ray, THREE.DoubleSide, hit);
            if (!h) continue;
            const d = h.distance ?? center.distanceTo(h.point);
            if (d < threshold) {
                thin++;
                if (thinSegs.length < MAX_HIGHLIGHT_SEGS * 6) {
                    thinSegs.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
                    thinSegs.push(vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
                    thinSegs.push(vc.x, vc.y, vc.z, va.x, va.y, va.z);
                }
            }
        }
        const dt = ((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) | 0;

        if (sampled === 0 || thin === 0) return null;
        const pctSamples = Math.round((thin / sampled) * 100);
        const severity = pctSamples > 5 ? SEV_LIKELY : SEV_QUALITY;

        return {
            id: `thin-wall-${obj.id}`,
            checkId: "thin-wall",
            severity,
            title: `Walls thinner than ${threshold} mm — likely to fail or skip on a 0.4 mm nozzle.`,
            technicalDetail: `${thin} of ${sampled} sampled triangles found opposing geometry within ${threshold} mm (~${pctSamples}% of surface) · scan ${dt} ms. Thicken the wall in your editor or print with a smaller nozzle.`,
            affectedObjectIds: [obj.id],
            affectedObjectName: obj.name || obj.type || "Part",
            highlight: { type: "edges", positions: new Float32Array(thinSegs) },
            fixes: [
                { id: "silence", label: "Mark as OK — I'll handle wall thickness in the slicer", kind: "silence", primary: true },
            ],
        };
    } finally {
        try { g?.dispose(); } catch { /* noop */ }
    }
}

// ---------------------------------------------------------------------------
// Registry — sync per-object and sync scene-level checks.
// Async checks (#2 thin-walls) are kicked off separately by the store.
// ---------------------------------------------------------------------------

const PER_OBJECT_CHECKS = [
    checkNonManifold,
    checkOverhangs,
    checkFloatingParts,
    checkBuildVolume,
    checkSmallFeatures,
];

const SCENE_CHECKS = [
    checkIntersections,
];

export function runAllChecks(scene) {
    const findings = [];
    const objects = scene?.objects || [];
    for (const obj of objects) {
        for (const check of PER_OBJECT_CHECKS) {
            try {
                const f = check(obj, scene);
                if (f) findings.push(f);
            } catch (e) {
                // eslint-disable-next-line no-console
                console.warn("[printability] check threw on object", obj?.id, e);
            }
        }
    }
    for (const check of SCENE_CHECKS) {
        try {
            const out = check(scene);
            if (Array.isArray(out)) findings.push(...out);
            else if (out) findings.push(out);
        } catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[printability] scene check threw", e);
        }
    }
    return findings;
}

/** Iterate every printable object and kick off the thin-walls async
 *  scan in parallel. Returns when every per-object scan settles. */
export async function runAsyncChecks(scene) {
    const objects = (scene?.objects || []).filter(isPrintable);
    const tasks = objects.map(async (obj) => {
        try { return await scanThinWallsAsync(obj); }
        catch (e) {
            // eslint-disable-next-line no-console
            console.warn("[printability] async thin-wall scan threw on object", obj?.id, e);
            return null;
        }
    });
    const results = await Promise.all(tasks);
    return results.filter(Boolean);
}

export const SEVERITY_RANK = { "will-fail": 0, "likely-fail": 1, "quality": 2, "ok": 3 };
export function sortBySeverity(findings) {
    return [...findings].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9));
}

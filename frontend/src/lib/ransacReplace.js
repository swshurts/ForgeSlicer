// Pure helpers for RANSAC Phase 4 "Replace with primitives".
//
// Extracted from ReverseEngineerDialog.jsx so the math can be unit-
// tested without dragging in the React tree (which transitively pulls
// in axios — and CRA's default Jest config can't transform axios as
// ESM, so a direct import of the dialog explodes the test runner).
//
// All functions are pure. The dialog imports the helper and calls it
// from its onReplaceWithPrimitives click handler.

import * as THREE from "three";

// Minimal scene-object descriptor builder. We deliberately do NOT
// import `buildPrimitive` from `primitiveDefaults.js` because that
// pulls in textureGeometry.js / sweepGeometry.js / textGeometry.js,
// which transitively pull in three modules CRA's default Jest config
// can't transform — making this helper untestable. The dialog only
// cares about a small set of fields (type/modifier/name/dims/position
// /rotation/scale), all of which we fill in directly here.
let _idSeq = 0;
function makeId(prefix) {
    _idSeq += 1;
    return `${prefix}-${Date.now()}-${_idSeq}`;
}
function makePrim(type, dims, position, rotation, name) {
    return {
        id: makeId(type),
        type,
        modifier: "positive",
        name,
        position,
        rotation: rotation || [0, 0, 0],
        scale: [1, 1, 1],
        dims,
        visible: true,
        locked: false,
        colorIndex: 7,
    };
}

/** Parse the backend's `bbox: [[xmin,ymin,zmin], [xmax,ymax,zmax]]`
 *  shape — NOT the `{ min, max }` object form a previous version of
 *  this code expected. Returns null when the shape is unexpected so
 *  the caller can fall back to defaults. */
export function bboxSize(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 2) return null;
    const lo = bbox[0], hi = bbox[1];
    if (!Array.isArray(lo) || !Array.isArray(hi) || lo.length < 3 || hi.length < 3) return null;
    return {
        x: hi[0] - lo[0],
        y: hi[1] - lo[1],
        z: hi[2] - lo[2],
        cx: (hi[0] + lo[0]) / 2,
        cy: (hi[1] + lo[1]) / 2,
        cz: (hi[2] + lo[2]) / 2,
    };
}

/** Rotation that maps the local +Z axis onto `axis` (a 3-tuple).
 *  Returns Euler degrees [x,y,z]. Used by cylinder + plane conversion
 *  since the parametric cylinder primitive's local axis is +Z. */
export function eulerToAlignZ(axis) {
    const a = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), a);
    const e = new THREE.Euler().setFromQuaternion(q, "XYZ");
    return [
        THREE.MathUtils.radToDeg(e.x),
        THREE.MathUtils.radToDeg(e.y),
        THREE.MathUtils.radToDeg(e.z),
    ];
}

/** Build the source→world Matrix4 for an imported scene object so we
 *  can take coordinates the segmentation API returned (which sit in
 *  the SOURCE STL frame) and place them in scene world space. */
function localToWorldMatrix(obj) {
    const rot = obj?.rotation || [0, 0, 0];
    const sc  = obj?.scale    || [1, 1, 1];
    const pos = obj?.position || [0, 0, 0];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(rot[0]),
        THREE.MathUtils.degToRad(rot[1]),
        THREE.MathUtils.degToRad(rot[2]),
    ));
    return new THREE.Matrix4().compose(
        new THREE.Vector3(pos[0], pos[1], pos[2]),
        q,
        new THREE.Vector3(sc[0], sc[1], sc[2]),
    );
}

/** Convert an array of RANSAC primitive descriptors (in the source
 *  STL coordinate system) to scene object descriptors ready for
 *  `useScene.replaceObjects`. When `sourceObj` is provided, every
 *  position / axis is transformed through the source object's
 *  local→world matrix so the new primitives land where the imported
 *  mesh visually sits. */
export function primitivesToSceneObjects(primitives, sourceObj = null) {
    const out = [];
    const local2world = sourceObj ? localToWorldMatrix(sourceObj) : new THREE.Matrix4();
    // Rotation-only sibling for transforming axes/normals (no scale
    // contamination of unit-vectors).
    const rotOnly = new THREE.Matrix4().extractRotation(local2world);
    const xform = (xyz) => {
        const v = new THREE.Vector3(xyz[0], xyz[1], xyz[2]).applyMatrix4(local2world);
        return [v.x, v.y, v.z];
    };
    const xformAxis = (xyz) => {
        const v = new THREE.Vector3(xyz[0], xyz[1], xyz[2]).applyMatrix4(rotOnly).normalize();
        return [v.x, v.y, v.z];
    };

    for (const p of primitives || []) {
        if (p.type === "sphere") {
            const r = Math.max(0.1, p.params?.radius ?? 1);
            const cSource = p.params?.center || p.centroid || [0, 0, r];
            out.push(makePrim("sphere", { r }, xform(cSource), null,
                `Sphere (RE r=${r.toFixed(1)})`));
        } else if (p.type === "cylinder") {
            const r = Math.max(0.1, p.params?.radius ?? 1);
            const h = Math.max(0.1, p.params?.height ?? 10);
            const cSource = p.params?.center || p.centroid || [0, 0, h / 2];
            const axSource = p.params?.axis || [0, 0, 1];
            out.push(makePrim("cylinder", { r, h, segments: 64 },
                xform(cSource),
                eulerToAlignZ(xformAxis(axSource)),
                `Cylinder (RE r=${r.toFixed(1)} h=${h.toFixed(1)})`));
        } else if (p.type === "plane") {
            const size = bboxSize(p.bbox);
            const exts = size ? [size.x, size.y, size.z].sort((a, b) => a - b) : null;
            const sx = exts && exts[2] > 0.5 ? exts[2] : 20;
            const sy = exts && exts[1] > 0.5 ? exts[1] : 20;
            const sz = exts && exts[0] > 0.1 ? Math.max(0.5, exts[0]) : 1;
            const cSource = p.centroid || [size?.cx ?? 0, size?.cy ?? 0, size?.cz ?? 0];
            const nSource = p.params?.normal || [0, 0, 1];
            out.push(makePrim("cube", { x: sx, y: sy, z: sz },
                xform(cSource),
                eulerToAlignZ(xformAxis(nSource)),
                `Plane (RE ${sx.toFixed(0)}×${sy.toFixed(0)} mm)`));
        }
    }
    return out;
}

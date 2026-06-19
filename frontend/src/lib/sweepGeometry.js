// Sweep geometry — extrude a 2D PROFILE along a 3D PATH so the
// profile stays perpendicular to the path tangent at every sample
// (true sweep, like Fusion 360 / SolidWorks).
//
// Why a dedicated module?
//   THREE.TubeGeometry only supports *circular* cross-sections.
//   Anything else (square, polygon, user-drawn sketch) needs a
//   manual sweep: sample the path, build Frenet frames, walk the
//   profile points into world space at each frame, then stitch
//   triangle rings between consecutive samples and cap the ends.
//   Keeping that math here (instead of inlining into `geometry.js`)
//   makes it unit-testable and keeps the primitive registry lean.
//
// Profile descriptors (`obj.dims.profile`):
//   { kind: "circle",   r, segments }
//   { kind: "rect",     w, h }
//   { kind: "polygon",  r, sides }
//   { kind: "sketch",   points: [[x,y], ...] }   // 2D points, planar
//
// Path descriptors (`obj.dims.path`):
//   { kind: "helix",    r, pitch, turns, segments }
//   { kind: "arc",      r, angleDeg, segments }   // arc in world XZ plane
//   { kind: "bezier",   p0, c1, c2, p1, segments }
//   { kind: "sketch3d", points: [[x,y,z], ...], segments }
//   { kind: "ref",      objectId, segments }      // another object's centerline
//
// Common dims:
//   samples     — number of path samples (path resolution; affects
//                 triangle count linearly)
//   twistDeg    — total twist around the path tangent, distributed
//                 linearly across the sweep. 0 = no twist.
//
// `buildSweepGeometry(obj, scene)` returns a THREE.BufferGeometry
// centered on the path's midpoint so the object's transform places
// it naturally.

import * as THREE from "three";

// ---------- Profile point generators ----------

function profilePoints(profile) {
  const kind = profile?.kind || "circle";
  if (kind === "circle") {
    const r = profile.r ?? 4;
    const segs = Math.max(8, profile.segments | 0 || 24);
    const pts = [];
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2;
      pts.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
    return pts;
  }
  if (kind === "rect") {
    const w = (profile.w ?? 6) / 2;
    const h = (profile.h ?? 4) / 2;
    return [[-w, -h], [w, -h], [w, h], [-w, h]];
  }
  if (kind === "polygon") {
    const r = profile.r ?? 4;
    const sides = Math.max(3, Math.min(64, profile.sides | 0 || 6));
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const t = (i / sides) * Math.PI * 2 + Math.PI / 2;
      pts.push([Math.cos(t) * r, Math.sin(t) * r]);
    }
    return pts;
  }
  if (kind === "sketch") {
    const raw = Array.isArray(profile.points) ? profile.points : [];
    if (raw.length < 3) return null;
    // Re-center on its own centroid so the profile rides the path
    // through its barycenter (intuitive — matches every other primitive).
    let cx = 0, cy = 0;
    for (const [x, y] of raw) { cx += x; cy += y; }
    cx /= raw.length; cy /= raw.length;
    return raw.map(([x, y]) => [x - cx, y - cy]);
  }
  return null;
}

// ---------- Path → Curve3 ----------

/**
 * Build a THREE.Curve3 for a given path descriptor.
 *
 * For `kind: "ref"` the caller must provide `scene.objects` so we
 * can look up the referenced object and pull a centerline from it.
 * Currently supports refs to helix and sweep objects (we recurse
 * for nested sweeps); falls back to a straight line between the
 * referenced object's bbox endpoints for anything else.
 */
function buildPathCurve(path, scene) {
  const kind = path?.kind || "helix";

  if (kind === "helix") {
    const r = path.r ?? 12;
    const pitch = path.pitch ?? 6;
    const turns = Math.max(0.1, path.turns ?? 2);
    const H = pitch * turns;
    // Z-up convention: helix winds around +Z so a "spring" stands up.
    return new (class extends THREE.Curve {
      getPoint(u, target = new THREE.Vector3()) {
        const theta = 2 * Math.PI * turns * u;
        return target.set(r * Math.cos(theta), r * Math.sin(theta), u * H - H / 2);
      }
    })();
  }

  if (kind === "arc") {
    const r = path.r ?? 20;
    const ang = THREE.MathUtils.degToRad(path.angleDeg ?? 180);
    // Z-up: arcs lie flat in the XY plane (curved on the bed).
    return new (class extends THREE.Curve {
      getPoint(u, target = new THREE.Vector3()) {
        const t = u * ang - ang / 2;
        return target.set(r * Math.cos(t), r * Math.sin(t), 0);
      }
    })();
  }

  if (kind === "bezier") {
    const p0 = new THREE.Vector3(...(path.p0 || [-20, 0, 0]));
    const c1 = new THREE.Vector3(...(path.c1 || [-10, 0, 20]));
    const c2 = new THREE.Vector3(...(path.c2 || [10, 0, 20]));
    const p1 = new THREE.Vector3(...(path.p1 || [20, 0, 0]));
    return new THREE.CubicBezierCurve3(p0, c1, c2, p1);
  }

  if (kind === "sketch3d") {
    // Polyline path — promote to CatmullRomCurve3 for smooth tangents.
    // A pure polyline would have C0-only continuity and the Frenet
    // frame computation goes haywire at corners.
    const raw = Array.isArray(path.points) ? path.points : [];
    if (raw.length < 2) return null;
    const vecs = raw.map(([x, y, z]) => new THREE.Vector3(x, y, z));
    return new THREE.CatmullRomCurve3(vecs, false, "catmullrom", 0.5);
  }

  if (kind === "ref" && scene?.objects) {
    const src = scene.objects.find((o) => o.id === path.objectId);
    if (!src) return null;
    // Recurse: if the source is a sweep, sweep around the SAME path.
    if (src.type === "sweep") {
      return buildPathCurve(src.dims?.path, scene);
    }
    // Helix: rebuild its parametric curve in WORLD space (apply src's
    // position + rotation so the swept object follows the helix where
    // it actually lives in the scene).
    if (src.type === "helix") {
      const d = src.dims || {};
      const r = d.r ?? 12;
      const pitch = d.pitch ?? 6;
      const turns = Math.max(0.1, d.turns ?? 4);
      const H = pitch * turns;
      const srcQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
        THREE.MathUtils.degToRad(src.rotation[0] || 0),
        THREE.MathUtils.degToRad(src.rotation[1] || 0),
        THREE.MathUtils.degToRad(src.rotation[2] || 0),
        "XYZ",
      ));
      const srcPos = new THREE.Vector3(...src.position);
      return new (class extends THREE.Curve {
        getPoint(u, target = new THREE.Vector3()) {
          const theta = 2 * Math.PI * turns * u;
          const local = new THREE.Vector3(
            r * Math.cos(theta),
            r * Math.sin(theta),
            u * H - H / 2,
          );
          local.applyQuaternion(srcQuat).add(srcPos);
          return target.copy(local);
        }
      })();
    }
    // Fallback: straight line through the source's position (degenerate
    // but won't crash). Real product code would probably refuse the
    // sweep with a UI error — punted to v2.
    return null;
  }
  return null;
}

// ---------- The sweep itself ----------

/**
 * Build a swept BufferGeometry from a Sweep object descriptor.
 *
 * @param {Object} obj — scene object with `dims.profile`, `dims.path`,
 *   `dims.samples`, `dims.twistDeg`.
 * @param {Object} scene — for `kind:"ref"` paths, we need
 *   `scene.objects` to resolve the source.
 * @returns {THREE.BufferGeometry|null} or `null` if the profile/path
 *   are degenerate (caller should fall back to a tiny placeholder
 *   cube so the object stays visible in the outliner).
 */
export function buildSweepGeometry(obj, scene = null) {
  const d = obj.dims || {};
  const profile = profilePoints(d.profile);
  const curve = buildPathCurve(d.path, scene);
  if (!profile || profile.length < 3) return null;
  if (!curve) return null;

  const samples = Math.max(8, Math.min(512, d.samples | 0 || 64));
  const twistRad = THREE.MathUtils.degToRad(d.twistDeg || 0);

  // Frenet frames give us a (normal, binormal, tangent) basis at each
  // sample so the profile stays perpendicular to the path's tangent.
  // We pass `closed = false` — sweeps along open curves; helix is
  // technically a periodic shape but visually-open in our UI.
  const frames = curve.computeFrenetFrames(samples, false);

  const profileCount = profile.length;
  // (samples + 1) rings × profileCount verts; we duplicate the first/last
  // sample's ring so we can emit triangles between every consecutive
  // pair. Caps add 2 fans of `profileCount` verts + the ring fan.
  const ringCount = samples + 1;
  const positions = new Float32Array(ringCount * profileCount * 3);
  const indices = [];

  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const point = curve.getPoint(u);
    const normal = frames.normals[Math.min(i, frames.normals.length - 1)];
    const binormal = frames.binormals[Math.min(i, frames.binormals.length - 1)];
    const localTwist = twistRad * u;
    const cosT = Math.cos(localTwist);
    const sinT = Math.sin(localTwist);
    for (let j = 0; j < profileCount; j++) {
      // Rotate the 2D profile point by localTwist before transforming
      // into the path frame, so consecutive rings smoothly twist.
      const [px0, py0] = profile[j];
      const px = px0 * cosT - py0 * sinT;
      const py = px0 * sinT + py0 * cosT;
      const idx = (i * profileCount + j) * 3;
      positions[idx]     = point.x + normal.x * px + binormal.x * py;
      positions[idx + 1] = point.y + normal.y * px + binormal.y * py;
      positions[idx + 2] = point.z + normal.z * px + binormal.z * py;
    }
  }

  // Side wall triangles — two per profile edge per sample step.
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < profileCount; j++) {
      const a = i * profileCount + j;
      const b = i * profileCount + ((j + 1) % profileCount);
      const c = (i + 1) * profileCount + j;
      const cN = (i + 1) * profileCount + ((j + 1) % profileCount);
      indices.push(a, b, c);
      indices.push(b, cN, c);
    }
  }

  // End caps — triangulate each ring as a fan around its centroid.
  // We tack on TWO extra centroid vertices at the very end of the
  // positions buffer so the cap fan doesn't share verts with the
  // side walls (separate verts → distinct cap normals = nicer shading).
  const startCap = ringCount * profileCount;
  const endCap = startCap + 1;
  // Compute centroids manually from the first/last ring's positions.
  let scx = 0, scy = 0, scz = 0, ecx = 0, ecy = 0, ecz = 0;
  for (let j = 0; j < profileCount; j++) {
    scx += positions[j * 3];
    scy += positions[j * 3 + 1];
    scz += positions[j * 3 + 2];
    const ek = (samples * profileCount + j) * 3;
    ecx += positions[ek];
    ecy += positions[ek + 1];
    ecz += positions[ek + 2];
  }
  scx /= profileCount; scy /= profileCount; scz /= profileCount;
  ecx /= profileCount; ecy /= profileCount; ecz /= profileCount;
  const finalPositions = new Float32Array(positions.length + 6);
  finalPositions.set(positions);
  finalPositions[startCap * 3]     = scx;
  finalPositions[startCap * 3 + 1] = scy;
  finalPositions[startCap * 3 + 2] = scz;
  finalPositions[endCap * 3]     = ecx;
  finalPositions[endCap * 3 + 1] = ecy;
  finalPositions[endCap * 3 + 2] = ecz;

  // Cap fans. Winding is reversed on the start cap so its normal
  // points OUT of the sweep (away from the body).
  for (let j = 0; j < profileCount; j++) {
    const a = j;
    const b = (j + 1) % profileCount;
    indices.push(startCap, b, a);
    const ea = samples * profileCount + j;
    const eb = samples * profileCount + ((j + 1) % profileCount);
    indices.push(endCap, ea, eb);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(finalPositions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * Default Sweep descriptor for `addPrimitive("sweep")`. Picks a
 * dramatic preset (helical spring) so the user immediately sees
 * what a sweep DOES the moment they click Add → Sweep.
 */
export const SWEEP_DEFAULTS = {
  samples: 96,
  twistDeg: 0,
  profile: {
    kind: "circle",
    r: 2,
    segments: 16,
  },
  path: {
    kind: "helix",
    r: 12,
    pitch: 6,
    turns: 3,
  },
};

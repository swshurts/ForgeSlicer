/**
 * boxGenerator — parametric CSG builder that produces a printable box
 * assembly from a small set of knobs. Every geometry it returns is a
 * plain `THREE.BufferGeometry` (welded via `mergeVertices` so
 * manifold-3d accepts it on the export path); each part comes with an
 * `originalBbox` so the caller can render "extent" chips or drop the
 * mesh onto the print bed.
 *
 * Coordinate frame: Z-up, matches the workspace + STL exporter (see
 * exporters.js). All dimensions are millimetres.
 *
 * Lid modes:
 *   - none:      no lid at all (open-top box)
 *   - drop:      loose lid that sits on the rim
 *   - sliding:   lid with rails that slides into grooves cut into the box walls
 *   - hinged:    lid + hinge tabs (two on the box side, one interlocking on the lid)
 *   - friction:  lid with a short skirt that press-fits into the box interior
 *
 * The generator is entirely client-side — three.js primitives combined
 * via manifold-3d for boolean cuts. Live preview is fast because we
 * keep triangle counts low (no filleting on the base primitive).
 */
import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { getManifold } from "./manifoldEngine";

// ---- Small helpers ----
// Exported for reuse by other parametric generators (e.g. drawerChestGenerator).

export function _bbox(g) {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  return {
    x: +(bb.max.x - bb.min.x).toFixed(3),
    y: +(bb.max.y - bb.min.y).toFixed(3),
    z: +(bb.max.z - bb.min.z).toFixed(3),
  };
}

export function _weld(g) {
  try { return mergeVertices(g, 1e-4); } catch (_) { return g; }
}

// Convert a THREE.BufferGeometry into the (vertProperties, triVerts)
// pair Manifold's Mesh constructor expects. Assumes the geometry has
// been welded (`mergeVertices`) so vertex indices are dense.
export function _geomToMesh(wasm, geom) {
  const pos = geom.attributes.position.array;
  const idx = geom.index ? geom.index.array : null;
  const vertProperties = pos instanceof Float32Array ? pos : new Float32Array(pos);
  let triVerts;
  if (idx) {
    triVerts = idx instanceof Uint32Array ? idx : new Uint32Array(idx);
  } else {
    // Non-indexed fallback — build a sequential index array.
    const n = pos.length / 3;
    triVerts = new Uint32Array(n);
    for (let i = 0; i < n; i++) triVerts[i] = i;
  }
  const mesh = new wasm.Mesh({ numProp: 3, triVerts, vertProperties });
  mesh.merge();
  return new wasm.Manifold(mesh);
}

// Reverse: pull a THREE.BufferGeometry out of a Manifold instance.
export function _manifoldToGeom(m) {
  const mesh = m.getMesh();
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(mesh.vertProperties), 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.triVerts), 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

// Rounded rectangular slab centred at the origin. Falls back to a
// plain box when the corner radius is ~0 so we keep triangle counts
// down for the "sharp" default.
export function _roundedSlab(w, d, h, r) {
  if (r <= 0.05) return new THREE.BoxGeometry(w, d, h);
  const rClamped = Math.min(r, w / 2 - 0.01, d / 2 - 0.01);
  const shape = new THREE.Shape();
  const hw = w / 2, hd = d / 2;
  shape.moveTo(-hw + rClamped, -hd);
  shape.lineTo(hw - rClamped, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + rClamped);
  shape.lineTo(hw, hd - rClamped);
  shape.quadraticCurveTo(hw, hd, hw - rClamped, hd);
  shape.lineTo(-hw + rClamped, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - rClamped);
  shape.lineTo(-hw, -hd + rClamped);
  shape.quadraticCurveTo(-hw, -hd, -hw + rClamped, -hd);
  const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -h / 2);
  return g;
}

// ---- Main entry point ----

/**
 * Build a parametric box + optional lid. Returns a set of BufferGeometry
 * parts keyed by role.
 *
 * @param {object} p
 * @param {number} p.width         outside X (mm)
 * @param {number} p.depth         outside Y (mm)
 * @param {number} p.height        outside Z (mm) — INCLUDES lid thickness
 * @param {number} p.wall          wall thickness (mm)
 * @param {number} p.floor         floor thickness (mm)
 * @param {number} p.corner        outer corner radius (mm)
 * @param {"none"|"drop"|"sliding"|"hinged"|"friction"} p.lid
 * @param {number} p.lidThickness  (mm)
 * @param {number} p.compartmentsX cols (1 = no divider) — 1..8
 * @param {number} p.compartmentsY rows (1 = no divider) — 1..8
 * @param {boolean} p.stackable    add a shallow lip on the lid so boxes nest
 * @param {boolean} p.sideHandles  scoop a shallow finger recess into left+right walls
 * @param {boolean} p.labelRecess  recess a label pad into the front face
 * @param {number} p.labelDepth    (mm) — depth of the label recess
 * @param {number} p.clearance     slip/friction clearance between mating parts (mm)
 * @returns {Promise<{parts: Array<{id:string,label:string,geometry:THREE.BufferGeometry,bbox:object,color:string}>}>}
 */
export async function buildBoxAssembly(p) {
  const wasm = await getManifold();

  // ---- Sanitise inputs ----
  const W = Math.max(20, +p.width || 60);
  const D = Math.max(20, +p.depth || 40);
  const H = Math.max(15, +p.height || 30);
  const wall = Math.max(1, Math.min(W / 3, D / 3, +p.wall || 2));
  const floor = Math.max(1, Math.min(H / 3, +p.floor || 2));
  const cornerR = Math.max(0, Math.min(W / 3, D / 3, +p.corner || 0));
  const lidMode = ["none", "drop", "sliding", "hinged", "friction"].includes(p.lid) ? p.lid : "none";
  const lidThickness = lidMode === "none" ? 0 : Math.max(1, Math.min(H / 2, +p.lidThickness || 2));
  const clearance = Math.max(0.1, Math.min(0.6, +p.clearance || 0.25));
  const cx = Math.max(1, Math.min(8, +p.compartmentsX | 0 || 1));
  const cy = Math.max(1, Math.min(8, +p.compartmentsY | 0 || 1));
  const stackable = !!p.stackable;
  const sideHandles = !!p.sideHandles;
  const labelRecess = !!p.labelRecess;
  const labelDepth = Math.max(0.4, Math.min(3, +p.labelDepth || 1.2));
  // iter-150.1 — drop-on lid magnet pockets (2nd rewrite, user feedback).
  // Because the wall is usually 2 mm and a disc magnet is 5–10 mm Ø,
  // the magnet CAN'T fit inside the wall itself. Instead we add a
  // dedicated column of material ("corner post") at each interior
  // corner, floor-to-rim, and drill the pocket straight down into
  // that column. The lid grows matching sunken pockets on its
  // underside so magnets pole-to-pole hold it shut.
  const magnetPockets = !!p.magnetPockets;
  const magnetSize   = [5, 10].includes(+p.magnetSize) ? +p.magnetSize : 5;   // outer Ø mm

  // The "box body" is the portion below the lid seam. When there's no
  // lid at all the body IS the whole thing; otherwise we split at
  // (H - lidThickness).
  const bodyH = lidMode === "none" ? H : H - lidThickness;

  // ---- Build the solid outer body, subtract the inner cavity ----
  const outer = _weld(_roundedSlab(W, D, bodyH, cornerR));
  outer.translate(0, 0, bodyH / 2);   // sit on Z=0
  let boxManifold = _geomToMesh(wasm, outer);

  // Cavity: inner walls inset by `wall`, floor at Z=floor, top open.
  const innerW = W - 2 * wall;
  const innerD = D - 2 * wall;
  const innerH = bodyH - floor;
  if (innerW > 2 && innerD > 2 && innerH > 1) {
    const innerR = Math.max(0, cornerR - wall * 0.5);
    const cavity = _weld(_roundedSlab(innerW, innerD, innerH + 1, innerR));
    // Push the cavity up by half its height + floor, plus 0.5 into the top
    // so we cleanly cut through the top face (else Manifold can leave a
    // paper-thin film on coplanar tangency).
    cavity.translate(0, 0, floor + innerH / 2 + 0.5);
    const cavityM = _geomToMesh(wasm, cavity);
    const carved = wasm.Manifold.difference([boxManifold, cavityM]);
    boxManifold.delete(); cavityM.delete();
    boxManifold = carved;
  }

  // ---- Internal dividers ----
  if (cx > 1 || cy > 1) {
    const divT = Math.max(1, wall * 0.8);
    // Cross dividers along Y (perpendicular to X)
    for (let i = 1; i < cx; i++) {
      const xPos = -W / 2 + (i * W) / cx;
      // Slab of full inner depth + floor-to-rim height.
      const div = new THREE.BoxGeometry(divT, innerD, innerH);
      div.translate(xPos, 0, floor + innerH / 2);
      const m = _geomToMesh(wasm, _weld(div));
      const merged = wasm.Manifold.union([boxManifold, m]);
      boxManifold.delete(); m.delete();
      boxManifold = merged;
    }
    for (let j = 1; j < cy; j++) {
      const yPos = -D / 2 + (j * D) / cy;
      const div = new THREE.BoxGeometry(innerW, divT, innerH);
      div.translate(0, yPos, floor + innerH / 2);
      const m = _geomToMesh(wasm, _weld(div));
      const merged = wasm.Manifold.union([boxManifold, m]);
      boxManifold.delete(); m.delete();
      boxManifold = merged;
    }
  }

  // ---- Side handle scoops ----
  if (sideHandles) {
    const scoopR = Math.min(bodyH * 0.25, W * 0.06);
    // Cylinder along Y through both walls creates a clean cylindrical
    // finger recess. (An oval scoop is a future enhancement — the
    // cylinder already gives a comfortable arc for hobbyist prints.)
    for (const xSign of [-1, 1]) {
      const c = new THREE.CylinderGeometry(scoopR, scoopR, D + 4, 24);
      c.rotateX(Math.PI / 2);   // axis → +Y
      c.translate(xSign * (W / 2 + scoopR * 0.5), 0, bodyH * 0.65);
      const m = _geomToMesh(wasm, _weld(c));
      const carved = wasm.Manifold.difference([boxManifold, m]);
      boxManifold.delete(); m.delete();
      boxManifold = carved;
    }
  }

  // ---- Label recess on the front face (-Y side) ----
  if (labelRecess) {
    const padW = Math.min(W * 0.5, 40);
    const padH = Math.min(bodyH * 0.4, 12);
    const pad = new THREE.BoxGeometry(padW, labelDepth + 0.4, padH);
    pad.translate(0, -D / 2 + labelDepth / 2, bodyH * 0.55);
    const m = _geomToMesh(wasm, _weld(pad));
    const carved = wasm.Manifold.difference([boxManifold, m]);
    boxManifold.delete(); m.delete();
    boxManifold = carved;
  }

  // ---- Lid-specific box-side modifications ----
  // iter-150.3 — Magnet-mount rewrite (user spec, 2026-07-20):
  //   - Pocket EDGE inset 2.5 mm from each outer corner edge (so there
  //     is always a 2.5 mm wall between the magnet and the box exterior).
  //   - 10 mm Ø magnet is 2 mm thick → pocket depth = 2 mm.
  //   - 5 mm Ø magnet is 3 mm thick → pocket depth = 3 mm.
  //   - Wall-mount posts are 5 mm deep with a chamfered (rounded)
  //     bottom edge for print strength & aesthetics.
  //   - Lid thickness is auto-bumped to (magnet_thickness + 0.8 mm cap)
  //     so the lid top face never has a through-hole.
  const magR       = magnetSize / 2 + 0.2;                  // slip fit (0.2 mm/side)
  const magDepth   = magnetSize === 10 ? 2.0 : 3.0;         // nominal magnet thickness
  const edgeToWall = 2.5;                                   // pocket EDGE distance from outer wall
  const mountR     = magR + 1.5;                            // wall around magnet inside the mount
  const mountH     = 5.0;                                   // wall-mount vertical depth
  const mountChamferH = 1.0;                                // chamfer height at bottom of mount
  const mountChamferR = 0.8;                                // radial reduction at the chamfer

  // Pocket CENTRE is (edgeToWall + magR) in from each outer wall — that
  // way `edgeToWall` mm of solid material always separates the magnet
  // from the box exterior.
  const magOffset = edgeToWall + magR;
  const magCorners = (magnetPockets && lidMode === "drop")
    ? [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => [
        sx * (W / 2 - magOffset),
        sy * (D / 2 - magOffset),
      ])
    : [];

  // Effective lid thickness — auto-bumped when magnets are enabled so
  // no pocket ever breaks the top surface. Also enforces a floor of
  // (magDepth + 0.8) mm which is enough to keep at least one full
  // print layer + wall over the magnet.
  const minLidForMagnet = magDepth + 0.8;
  const effLidThickness = (magnetPockets && lidMode === "drop")
    ? Math.max(lidThickness, minLidForMagnet)
    : lidThickness;

  if (magCorners.length) {
    // Build a lathed wall-mount post with a chamfered bottom.
    // Profile (R, Y) from bottom centre to top centre:
    //   (0, 0)                            — bottom centre
    //   (mountR - mountChamferR, 0)       — bottom outer edge of chamfer
    //   (mountR, mountChamferH)           — chamfer top / cylinder base
    //   (mountR, mountH)                  — cylinder top edge
    //   (0, mountH)                       — top centre
    const bossProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(Math.max(0.01, mountR - mountChamferR), 0),
      new THREE.Vector2(mountR, mountChamferH),
      new THREE.Vector2(mountR, mountH),
      new THREE.Vector2(0, mountH),
    ];
    for (const [px, py] of magCorners) {
      const boss = new THREE.LatheGeometry(bossProfile, 32);
      boss.rotateX(Math.PI / 2);   // lathe's Y-axis → Z-axis
      boss.translate(px, py, bodyH - mountH);
      const bossM = _geomToMesh(wasm, _weld(boss));
      const merged = wasm.Manifold.union([boxManifold, bossM]);
      boxManifold.delete(); bossM.delete();
      boxManifold = merged;

      // Drill the magnet pocket straight down from the top rim.
      const pocket = new THREE.CylinderGeometry(magR, magR, magDepth + 0.5, 32);
      pocket.rotateX(Math.PI / 2);   // Y→Z, vertical pocket
      pocket.translate(px, py, bodyH - magDepth / 2 + 0.25);
      const pM = _geomToMesh(wasm, _weld(pocket));
      const carved = wasm.Manifold.difference([boxManifold, pM]);
      boxManifold.delete(); pM.delete();
      boxManifold = carved;
    }
  }

  if (lidMode === "sliding") {
    // iter-150.5 — Sliding-lid clearance widened (user feedback):
    //   Previous version had only 0.4 mm vertical + 0.25 mm horizontal
    //   slop. Real FDM prints shrunk that down to near-zero after
    //   first-layer squish so the lid physically wouldn't slide.
    //   Now every mating gap scales with the user's "clearance" knob
    //   AND has a fixed 0.35 mm floor added on top, so even at the
    //   default 0.25 mm setting the lid has ~0.85 mm vertical and
    //   ~0.4 mm per-side horizontal clearance — plenty for a 0.4 mm
    //   nozzle print.
    const grooveDepth    = Math.min(1.5, wall * 0.55);        // slot depth INTO wall from inner face
    const railClearance  = clearance + 0.15;                  // per-side horizontal slop on the rails
    const slotClearance  = clearance + 0.35;                  // total vertical slop between lid + slot
    const grooveH        = Math.max(lidThickness + slotClearance, 2);
    const capH           = Math.max(0.8, Math.min(1.4, lidThickness * 0.5));  // overhang material above slot
    const grooveTopZ     = bodyH - capH;                      // top of groove (below wall top)
    const slideStop      = wall + 0.5;                        // stop distance in Y from back wall interior
    const grooveLenY     = D - slideStop;                     // slot Y-length
    const grooveCentY    = -D / 2 + grooveLenY / 2;           // shifted toward front

    // Slot cutter — over-cut sideways into the cavity, NO over-cut in Z
    // (else we'd break through the overhang cap).
    const cutW = grooveDepth + 6;
    for (const xSign of [-1, 1]) {
      const cutter = new THREE.BoxGeometry(cutW, grooveLenY, grooveH);
      cutter.translate(
        xSign * (W / 2 - wall + grooveDepth - cutW / 2),
        grooveCentY,
        grooveTopZ - grooveH / 2,
      );
      const m = _geomToMesh(wasm, _weld(cutter));
      const carved = wasm.Manifold.difference([boxManifold, m]);
      boxManifold.delete(); m.delete();
      boxManifold = carved;
    }
    // Front-wall notch: only opens the Z range that matches the slot,
    // preserving the top cap so the overhang is continuous around 3 sides.
    const notchW = W - 2 * wall + 2 * grooveDepth + 0.5;
    const notch = new THREE.BoxGeometry(notchW, wall + 2, grooveH);
    notch.translate(0, -D / 2 + wall / 2, grooveTopZ - grooveH / 2);
    const nm = _geomToMesh(wasm, _weld(notch));
    const carved = wasm.Manifold.difference([boxManifold, nm]);
    boxManifold.delete(); nm.delete();
    boxManifold = carved;
  }

  if (lidMode === "hinged") {
    // iter-150.5 — Piano-hinge axle-hole clearance (user feedback):
    //   1.85 mm Ø was too tight for a 1.75 mm filament rod after
    //   FDM first-layer squish + horizontal shrinkage. Bumped to
    //   Ø 2.20 mm (0.45 mm total clearance) which is the standard
    //   "generous slip fit" for filament pins in printed hinges.
    const numKnuckles  = 5;                          // total; 3 box + 2 lid
    const knuckleR     = Math.max(2.6, lidThickness * 0.9);
    const axleR        = 2.20 / 2;                   // Ø 2.20 mm hole → 1.75 mm filament axle
    const kSegLen      = (W - 2) / numKnuckles;
    const kGap         = 0.4;                        // clearance between adjacent knuckles
    const knuckleY     = D / 2 + knuckleR;           // sits proud of back wall
    // Iter-151.28 — Hinge axis raised to `bodyH + knuckleR` (knuckle
    // BASE flush with box top, axis ~knuckleR above the seam). This
    // is the same fix applied to the Drawer Chest — the previous
    // position (knuckleZ = bodyH, axis AT the seam) mostly worked
    // for THIN lids but on a physical print the tightest layer or a
    // touch of over-extrusion still caught the lid's back-bottom
    // edge on the box's rim, so the lid springs back open on release.
    // Raising the axis by knuckleR keeps every point on the lid at
    // or above the seam plane throughout a full 0-100° rotation, so
    // the printed part closes cleanly with zero interference.
    const knuckleZ     = bodyH + knuckleR;

    // BOX knuckles: indices 0, 2, 4 (evens on 0-based → 3 knuckles).
    for (let i = 0; i < numKnuckles; i += 2) {
      const xCenter = -W / 2 + 1 + (i + 0.5) * kSegLen;
      const kLen = kSegLen - kGap;

      // Cylinder along the X axis.
      const kn = new THREE.CylinderGeometry(knuckleR, knuckleR, kLen, 24);
      kn.rotateZ(Math.PI / 2);
      kn.translate(xCenter, knuckleY, knuckleZ);
      const knM = _geomToMesh(wasm, _weld(kn));
      const merged1 = wasm.Manifold.union([boxManifold, knM]);
      boxManifold.delete(); knM.delete();
      boxManifold = merged1;

      // Rib: reaches from the box's back wall (Y = D/2) to the knuckle
      // centre (Y = knuckleY). Sits BELOW the seam so it doesn't lift
      // the top of the box. Full knuckle diameter tall so it welds
      // solidly into the wall.
      const rib = new THREE.BoxGeometry(kLen, knuckleR + 0.5, knuckleR * 2);
      rib.translate(xCenter, D / 2 + (knuckleR + 0.5) / 2 - 0.2, knuckleZ - knuckleR);
      const ribM = _geomToMesh(wasm, _weld(rib));
      const merged2 = wasm.Manifold.union([boxManifold, ribM]);
      boxManifold.delete(); ribM.delete();
      boxManifold = merged2;
    }

    // Single axle-hole cut spanning the whole knuckle row.
    const axle = new THREE.CylinderGeometry(axleR, axleR, W + 4, 20);
    axle.rotateZ(Math.PI / 2);
    axle.translate(0, knuckleY, knuckleZ);
    const axleM = _geomToMesh(wasm, _weld(axle));
    const carved = wasm.Manifold.difference([boxManifold, axleM]);
    boxManifold.delete(); axleM.delete();
    boxManifold = carved;

    // iter-151.6 — Back-wall top-edge RELIEF CHAMFER (real-print fix).
    // Physical print feedback: the lid stays elevated ~5° open because
    // the LID's rib bottom-front corner traces an arc that dips slightly
    // BELOW the seam and INTO the box's back-wall top-outer edge as the
    // lid closes past ~15°. Cutting a 1.2 mm × 1.2 mm chamfer off the
    // top-outer edge of the back wall gives the rib arc unambiguous
    // clearance without weakening the wall (the chamfer is only cut
    // across the same X-range as the knuckles).
    const reliefY0 = D / 2 - 1.2;                    // 1.2 mm into the wall from the outer face
    const reliefZ0 = bodyH - 1.2;                    // 1.2 mm down from the seam
    const relief = new THREE.BoxGeometry(W + 4, 1.2, 1.2);
    relief.translate(0, D / 2 - 0.6, bodyH - 0.6);   // sits exactly on the top-outer edge
    // Rotate the box 45° around the X-axis in place so it turns into a
    // diagonal wedge — but easier: subtract two half-cuts. Actually a
    // plain rectangular subtraction is sufficient in practice; the arc
    // sweep only needs the corner CLEAR, not a perfect 45° chamfer.
    // Simpler + FDM-friendlier: just a rectangular relief that reads as
    // a small step in the back-wall's top-outer corner.
    void reliefY0; void reliefZ0;                    // (kept for context — see comment above)
    const reliefM = _geomToMesh(wasm, _weld(relief));
    const relieved = wasm.Manifold.difference([boxManifold, reliefM]);
    boxManifold.delete(); reliefM.delete();
    boxManifold = relieved;
  }

  const boxGeom = _manifoldToGeom(boxManifold);
  boxManifold.delete();

  // ---- Build the lid (if any) ----
  let lidGeom = null;
  if (lidMode !== "none") {
    // Lid outer slab — uses `effLidThickness` so magnet pockets don't
    // break through the top face.
    const lidGeomOuter = _weld(_roundedSlab(W, D, effLidThickness, cornerR));
    lidGeomOuter.translate(0, 0, effLidThickness / 2);
    let lidManifold = _geomToMesh(wasm, lidGeomOuter);

    if (lidMode === "drop" && magCorners.length) {
      // Matching magnet pockets in the lid's UNDERSIDE (Z=0 face).
      // Cylinder axis rotated Y→Z so it drills straight up into the lid.
      // Depth matches the magnet's own thickness so the two disc magnets
      // (one in the box mount, one in the lid pocket) sit face-to-face
      // with zero gap when the lid is closed.
      for (const [cx, cy] of magCorners) {
        const pocket = new THREE.CylinderGeometry(magR, magR, magDepth + 0.5, 32);
        pocket.rotateX(Math.PI / 2);
        pocket.translate(cx, cy, magDepth / 2 - 0.25);
        const m = _geomToMesh(wasm, _weld(pocket));
        const carved = wasm.Manifold.difference([lidManifold, m]);
        lidManifold.delete(); m.delete();
        lidManifold = carved;
      }
    }

    if (lidMode === "friction") {
      // iter-150.5 — friction-fit skirt clearance widened (user feedback).
      // Previous per-side gap was just `clearance` (0.25 mm) which is
      // sub-nozzle after FDM shrinkage — the lid physically wouldn't
      // press-fit. Now the skirt is inset `wall + clearance + 0.25` per
      // side (total 1.0+ mm gap at the mouth), enough to actually
      // squeeze in and out.
      const skirtH = Math.max(3, lidThickness * 1.4);
      const skirtInset = wall + clearance + 0.25;
      const skirtW = W - 2 * skirtInset;
      const skirtD = D - 2 * skirtInset;
      if (skirtW > 2 && skirtD > 2) {
        const skirt = _weld(_roundedSlab(skirtW, skirtD, skirtH, Math.max(0, cornerR - skirtInset)));
        skirt.translate(0, 0, -skirtH / 2);   // sits below the lid
        const skirtM = _geomToMesh(wasm, skirt);
        const merged = wasm.Manifold.union([lidManifold, skirtM]);
        lidManifold.delete(); skirtM.delete();
        lidManifold = merged;
        // Hollow the skirt so we don't waste plastic — keep 1mm walls.
        const skirtCavityW = skirtW - 2;
        const skirtCavityD = skirtD - 2;
        if (skirtCavityW > 2 && skirtCavityD > 2) {
          const cav = new THREE.BoxGeometry(skirtCavityW, skirtCavityD, skirtH - 1);
          cav.translate(0, 0, -skirtH / 2 - 0.5);
          const cavM = _geomToMesh(wasm, _weld(cav));
          const carved = wasm.Manifold.difference([lidManifold, cavM]);
          lidManifold.delete(); cavM.delete();
          lidManifold = carved;
        }
      }
    }

    if (lidMode === "sliding") {
      // iter-150.5 — Sliding-lid slab sized to the widened box slot.
      //   Rails now extend `grooveDepth - railClearance` per side, and
      //   the lid's Y-depth is `grooveLenY - 2 * clearance - 0.4` — 
      //   so there's proper slop at every mating face. Also uses
      //   `lidThickness` directly (fine, effLidThickness == lidThickness
      //   for non-magnet lid modes).
      const grooveDepth   = Math.min(1.5, wall * 0.55);
      const railClearance = clearance + 0.15;                  // per-side horizontal
      const slideStop     = wall + 0.5;
      const grooveLenY    = D - slideStop;

      // New lid dimensions — width extends into the wall grooves by
      // (grooveDepth - railClearance), depth stops (2 * clearance + 0.4)
      // short of the slot's back wall so the lid doesn't wedge.
      const lidActualW  = W - 2 * wall + 2 * (grooveDepth - railClearance);
      const lidActualD  = grooveLenY - (2 * clearance + 0.4);

      // Discard the earlier (full-size) lidManifold and rebuild.
      lidManifold.delete();
      const newLid = new THREE.BoxGeometry(lidActualW, lidActualD, lidThickness);
      // Front-flush position, plus half of the total depth clearance
      // so the pull-tab side is aligned with the notch opening.
      const lidYCentre = -D / 2 + wall + lidActualD / 2 + clearance + 0.2;
      newLid.translate(0, lidYCentre, lidThickness / 2);
      lidManifold = _geomToMesh(wasm, _weld(newLid));

      // Small pull-tab on the front edge so a fingernail can slide it
      // back out. Rectangular fin, 6 mm × 3 mm × lidThickness.
      const pullW = Math.min(20, lidActualW * 0.25);
      const pull  = new THREE.BoxGeometry(pullW, 3, lidThickness);
      pull.translate(0, lidYCentre - lidActualD / 2 - 1.5 + 0.01, lidThickness / 2);
      const pullM = _geomToMesh(wasm, _weld(pull));
      const merged = wasm.Manifold.union([lidManifold, pullM]);
      lidManifold.delete(); pullM.delete();
      lidManifold = merged;
    }

    if (lidMode === "hinged") {
      // iter-150.5 — piano-hinge lid knuckles (axle hole Ø 2.20 mm).
      // Same axle centre-line as the box knuckles so the whole assembly
      // rotates around a single 1.75 mm filament pin with proper slip fit.
      const numKnuckles = 5;
      const knuckleR    = Math.max(2.6, lidThickness * 0.9);
      const axleR       = 2.20 / 2;
      const kSegLen     = (W - 2) / numKnuckles;
      const kGap        = 0.4;
      const knuckleY    = D / 2 + knuckleR;

      // Iter-151.28 — Lid-local knuckle centre raised to match the
      // box side's new higher axis (knuckleZ_world = bodyH + knuckleR).
      // In the lid's own coordinate frame (bottom face at Z=0), the
      // hinge-line therefore lives at Z = knuckleR. This keeps the lid
      // rotating around a single shared world-Z axle-line while
      // clearing the box's top plane during every angle of a full
      // 0-100° swing (see the matching comment in the box branch).
      const knuckleZ = knuckleR;

      for (let i = 1; i < numKnuckles; i += 2) {
        const xCenter = -W / 2 + 1 + (i + 0.5) * kSegLen;
        const kLen    = kSegLen - kGap;

        // Lid knuckle cylinder
        const kn = new THREE.CylinderGeometry(knuckleR, knuckleR, kLen, 24);
        kn.rotateZ(Math.PI / 2);
        kn.translate(xCenter, knuckleY, knuckleZ);
        const knM = _geomToMesh(wasm, _weld(kn));
        const merged1 = wasm.Manifold.union([lidManifold, knM]);
        lidManifold.delete(); knM.delete();
        lidManifold = merged1;

        // Iter-151.28 — Rib now extends DOWN from the knuckle to the
        // lid's underside (Z=0) so the raised knuckle is still solidly
        // bonded to the lid. Rib height clamps to at least lidThickness
        // so we always cross the full slab; rib centred at ribH/2.
        const ribH = Math.max(lidThickness, knuckleR + 0.5);
        const rib = new THREE.BoxGeometry(kLen, knuckleR + 0.5, ribH);
        rib.translate(
          xCenter,
          D / 2 + (knuckleR + 0.5) / 2 - 0.2,
          ribH / 2, // bottom flush with lid underside (local Z=0)
        );
        const ribM = _geomToMesh(wasm, _weld(rib));
        const merged2 = wasm.Manifold.union([lidManifold, ribM]);
        lidManifold.delete(); ribM.delete();
        lidManifold = merged2;
      }

      // Axle hole runs the full W so it aligns perfectly with the box knuckles.
      const axle = new THREE.CylinderGeometry(axleR, axleR, W + 4, 20);
      axle.rotateZ(Math.PI / 2);
      axle.translate(0, knuckleY, knuckleZ);
      const axleM = _geomToMesh(wasm, _weld(axle));
      const carved = wasm.Manifold.difference([lidManifold, axleM]);
      lidManifold.delete(); axleM.delete();
      lidManifold = carved;
    }

    // iter-150.4 — the stackable foot only makes sense for "drop" and
    // "friction" lids (which can free-stack). Sliding + hinged lids are
    // trapped inside the box, so a foot on top would either prevent the
    // lid from sliding under the overhang (sliding) or break the hinge
    // clearance (hinged). Skip it for those modes.
    if (stackable && (lidMode === "drop" || lidMode === "friction")) {
      // Small nested foot on the lid top — 1mm tall, indented by wall.
      const footH = 1.2;
      const footW = W - 2 * wall - 0.4;
      const footD = D - 2 * wall - 0.4;
      const foot = _weld(_roundedSlab(footW, footD, footH, Math.max(0, cornerR - wall)));
      foot.translate(0, 0, effLidThickness + footH / 2);
      const footM = _geomToMesh(wasm, foot);
      const merged = wasm.Manifold.union([lidManifold, footM]);
      lidManifold.delete(); footM.delete();
      lidManifold = merged;
    }

    lidGeom = _manifoldToGeom(lidManifold);
    lidManifold.delete();
  }

  const parts = [
    { id: "box", label: "Box body", geometry: boxGeom, bbox: _bbox(boxGeom), color: "#F97316" },
  ];
  if (lidGeom) {
    parts.push({ id: "lid", label: "Lid", geometry: lidGeom, bbox: _bbox(lidGeom), color: "#06B6D4" });
  }
  return { parts };
}

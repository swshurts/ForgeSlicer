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

function _bbox(g) {
  g.computeBoundingBox();
  const bb = g.boundingBox;
  return {
    x: +(bb.max.x - bb.min.x).toFixed(3),
    y: +(bb.max.y - bb.min.y).toFixed(3),
    z: +(bb.max.z - bb.min.z).toFixed(3),
  };
}

function _weld(g) {
  try { return mergeVertices(g, 1e-4); } catch (_) { return g; }
}

// Convert a THREE.BufferGeometry into the (vertProperties, triVerts)
// pair Manifold's Mesh constructor expects. Assumes the geometry has
// been welded (`mergeVertices`) so vertex indices are dense.
function _geomToMesh(wasm, geom) {
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
function _manifoldToGeom(m) {
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
function _roundedSlab(w, d, h, r) {
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
    // iter-150.1 — Sliding-lid captured groove (user feedback):
    //   Previous version cut the groove all the way to the top of the
    //   side walls, so the lid could just lift out. The lid needs to
    //   be TRAPPED under a strip of wall material (the "overhang").
    //
    //   Design: T-slot cut into inner top of each side wall, whose TOP
    //   sits capH mm BELOW the wall top — that cap is the overhang
    //   that captures the lid. Front wall notch matches the slot's
    //   vertical range exactly (also stops below the wall top), so
    //   the lid slides IN through that opening only. Back wall is
    //   solid → stops the lid.
    const grooveDepth = Math.min(1.5, wall * 0.55);       // slot depth INTO wall from inner face
    const grooveH     = Math.max(lidThickness + 0.4, 2);  // slot height
    const capH        = Math.max(0.8, Math.min(1.4, lidThickness * 0.5));  // material above groove
    const grooveTopZ  = bodyH - capH;                     // top of groove (below wall top)
    const slideStop   = wall + 0.5;                       // stop distance in Y from back wall interior
    const grooveLenY  = D - slideStop;                    // slot Y-length
    const grooveCentY = -D / 2 + grooveLenY / 2;          // shifted toward front

    // Slot cutter — over-cut sideways into the cavity, NO over-cut in Z
    // (else we'd break through the overhang cap).
    const cutW = grooveDepth + 6;   // 6 mm of over-cut into the cavity (safe empty space)
    for (const xSign of [-1, 1]) {
      const cutter = new THREE.BoxGeometry(cutW, grooveLenY, grooveH);
      // Cutter's outer edge sits at (W/2 - wall) + grooveDepth. Its
      // Z spans grooveTopZ - grooveH  →  grooveTopZ (top face flush).
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
    // iter-149.4 — Piano-hinge rewrite (user feedback):
    //   - Previous design had 2 side tabs on the box + 1 disconnected
    //     block on the lid → hinge didn't function, lid knuckle wasn't
    //     even attached to the lid.
    //   - New design uses N alternating knuckles (odd on box, even on
    //     lid) all sharing one axle. Axle hole Ø = 1.85 mm (slip fit
    //     for a 1.75 mm filament piece — the user's exact suggestion).
    //   - Each knuckle is connected to its host part via a solid rib
    //     so the printed part stays a single manifold.
    const numKnuckles  = 5;                          // total; 3 box + 2 lid
    const knuckleR     = Math.max(2.5, lidThickness * 0.9);
    const axleR        = 1.85 / 2;                   // 1.85 mm ⌀ hole → 1.75 mm filament axle
    const kSegLen      = (W - 2) / numKnuckles;
    const kGap         = 0.4;                        // clearance between adjacent knuckles
    const knuckleY     = D / 2 + knuckleR;           // sits proud of back wall
    const knuckleZ     = bodyH;                      // exactly on the box/lid seam

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
      // A tapered inner skirt that press-fits into the box cavity.
      const skirtH = Math.max(3, lidThickness * 1.4);
      const skirtInset = wall + clearance;
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
      // iter-149.4 — new sliding-lid: the lid ITSELF is smaller than
      // the box outer, sized to fit exactly into the T-slot pocket on
      // both sides. Rails are integral with the lid slab (no
      // free-hanging tabs). The prior version has been replaced —
      // hollow lid was completely wrong.
      const grooveDepth = Math.min(1.5, wall * 0.55);
      const grooveH     = Math.max(lidThickness + 0.4, 2);
      const slideStop   = wall + 0.5;
      const grooveLenY  = D - slideStop;

      // New lid dimensions — width extends into the wall grooves by
      // (grooveDepth - clearance), depth stops at the slot's back end.
      const lidActualW  = W - 2 * wall + 2 * (grooveDepth - clearance);
      const lidActualD  = grooveLenY - clearance;

      // Discard the earlier (full-size) lidManifold and rebuild.
      lidManifold.delete();
      const newLid = new THREE.BoxGeometry(lidActualW, lidActualD, lidThickness);
      // Shift front-flush with the box front (matches slot front-open).
      const lidYCentre = -D / 2 + wall + lidActualD / 2 + clearance / 2;
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
      // iter-149.4 — piano-hinge lid knuckles.
      // Odd indices (1, 3, ...) belong to the lid — 2 knuckles on a
      // 5-segment hinge. Same axle centre-line as the box knuckles so
      // the whole assembly rotates around a single 1.75 mm filament pin.
      const numKnuckles = 5;
      const knuckleR    = Math.max(2.5, lidThickness * 0.9);
      const axleR       = 1.85 / 2;
      const kSegLen     = (W - 2) / numKnuckles;
      const kGap        = 0.4;
      const knuckleY    = D / 2 + knuckleR;

      // Lid coord: bottom face at Z=0. When assembled, the lid sits on
      // top of the box body — but for the hinge, the knuckles' centre
      // should be at world-Z=bodyH which corresponds to Z=0 in the
      // lid's own frame.
      const knuckleZ = 0;

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

        // Rib attaching this knuckle to the lid's back edge (Y = D/2).
        // Sits ABOVE the seam so it welds into the lid's bottom face.
        const rib = new THREE.BoxGeometry(kLen, knuckleR + 0.5, knuckleR * 2);
        rib.translate(xCenter, D / 2 + (knuckleR + 0.5) / 2 - 0.2, knuckleZ + knuckleR);
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

    if (stackable) {
      // Small nested foot on the lid top — 1mm tall, indented by wall.
      const footH = 1.2;
      const footW = W - 2 * wall - 0.4;
      const footD = D - 2 * wall - 0.4;
      const foot = _weld(_roundedSlab(footW, footD, footH, Math.max(0, cornerR - wall)));
      foot.translate(0, 0, lidThickness + footH / 2);
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

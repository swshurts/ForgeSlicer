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
  if (lidMode === "sliding") {
    // Cut two grooves along the +X/-X inner walls at the top so a lid
    // with matching rails slides in from the +Y side.
    const grooveH = Math.min(2, wall * 0.8);
    const grooveDrop = grooveH + 0.4;
    for (const xSign of [-1, 1]) {
      const groove = new THREE.BoxGeometry(wall + 1, D + 2, grooveH);
      groove.translate(xSign * (W / 2 - wall / 2), 0, bodyH - grooveDrop);
      const m = _geomToMesh(wasm, _weld(groove));
      const carved = wasm.Manifold.difference([boxManifold, m]);
      boxManifold.delete(); m.delete();
      boxManifold = carved;
    }
  }

  if (lidMode === "hinged") {
    // Two hinge tabs on the back wall (+Y): cylinders with an axle hole.
    const tabH = 4;
    const tabT = 3;
    const axleR = 1.5;
    for (const xSign of [-1, 1]) {
      // Solid tab (add on)
      const tab = new THREE.BoxGeometry(tabT, tabH, tabT * 2.2);
      const xOff = xSign * (W / 2 - tabT * 1.5);
      tab.translate(xOff, D / 2 + tabH / 2, bodyH - tabT);
      const tabM = _geomToMesh(wasm, _weld(tab));
      const merged = wasm.Manifold.union([boxManifold, tabM]);
      boxManifold.delete(); tabM.delete();
      boxManifold = merged;
      // Axle hole
      const axle = new THREE.CylinderGeometry(axleR, axleR, tabT + 2, 24);
      axle.rotateZ(Math.PI / 2);   // axis → +X
      axle.translate(xOff, D / 2 + tabH / 2, bodyH - tabT);
      const axleM = _geomToMesh(wasm, _weld(axle));
      const carved = wasm.Manifold.difference([boxManifold, axleM]);
      boxManifold.delete(); axleM.delete();
      boxManifold = carved;
    }
  }

  const boxGeom = _manifoldToGeom(boxManifold);
  boxManifold.delete();

  // ---- Build the lid (if any) ----
  let lidGeom = null;
  if (lidMode !== "none") {
    // Lid outer slab.
    const lidGeomOuter = _weld(_roundedSlab(W, D, lidThickness, cornerR));
    lidGeomOuter.translate(0, 0, lidThickness / 2);
    let lidManifold = _geomToMesh(wasm, lidGeomOuter);

    if (lidMode === "drop") {
      // Drop-on lid: no additional geometry beyond a shallow flip-rim
      // that keeps it aligned. If stackable, add a nested lip UNDER
      // the lid so a second box can sit on top.
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
      // Rails along X-edges that ride in the grooves cut into the box.
      const railH = Math.min(2, wall * 0.8) - clearance;
      const railW = wall - clearance;
      for (const xSign of [-1, 1]) {
        const rail = new THREE.BoxGeometry(railW, D - clearance * 2, railH);
        rail.translate(xSign * (W / 2 - railW / 2 - clearance), 0, -railH / 2);
        const railM = _geomToMesh(wasm, _weld(rail));
        const merged = wasm.Manifold.union([lidManifold, railM]);
        lidManifold.delete(); railM.delete();
        lidManifold = merged;
      }
    }

    if (lidMode === "hinged") {
      // One central knuckle that fits between the two box tabs, with
      // an axle hole at the same height.
      const tabH = 4;
      const tabT = 3;
      const axleR = 1.5;
      const knuckle = new THREE.BoxGeometry(tabT * 2, tabH - clearance * 2, tabT * 2.2);
      knuckle.translate(0, D / 2 + tabH / 2, -tabT);
      const knuckleM = _geomToMesh(wasm, _weld(knuckle));
      const merged = wasm.Manifold.union([lidManifold, knuckleM]);
      lidManifold.delete(); knuckleM.delete();
      lidManifold = merged;
      // Axle hole
      const axle = new THREE.CylinderGeometry(axleR + 0.05, axleR + 0.05, tabT * 4, 24);
      axle.rotateZ(Math.PI / 2);
      axle.translate(0, D / 2 + tabH / 2, -tabT);
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

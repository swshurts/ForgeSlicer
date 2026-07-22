/**
 * drawerChestGenerator — parametric CSG builder for a printable
 * multi-drawer chest / chest-of-drawers assembly.
 *
 * Produces separate manifolds for:
 *   - Frame (main cabinet, feet integral, drawer/hinged-box cavities cut out)
 *   - N drawers (each an open-top box with a front face + optional
 *     recessed handle + optional glide nubs)
 *   - Optional hinged lid for a top compartment (top-opening chest style)
 *   - Optional detachable top cap
 *
 * Coordinate frame: Z-up. Origin at floor-centre of the frame footprint.
 * All dimensions in millimetres.
 */
import * as THREE from "three";
import { getManifold } from "./manifoldEngine";
import { _bbox, _weld, _geomToMesh, _manifoldToGeom, _roundedSlab } from "./boxGenerator";

/**
 * Compute mesh volume in mm³ from a THREE.BufferGeometry using the
 * signed-tetrahedron sum. Assumes the geometry is a closed manifold
 * (which every generator output is, since it came from Manifold).
 */
function _volumeMm3(geometry) {
  const pos = geometry.attributes.position;
  const idx = geometry.index;
  let vol = 0;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
      const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
      const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
      vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const ax = pos.getX(i),     ay = pos.getY(i),     az = pos.getZ(i);
      const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
      const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
      vol += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
  }
  return Math.abs(vol);
}

/**
 * Build a full drawer-chest parts bundle.
 *
 * @param {object} params
 * @param {number} params.width       Outer width (X), mm
 * @param {number} params.depth       Outer depth (Y), mm
 * @param {number} params.height      Outer height (Z), mm (feet + cap included)
 * @param {number} params.wall        Frame wall thickness, mm
 * @param {number} params.rows        Number of drawer slots (1..8)
 * @param {number[]} [params.drawerHeights]  Per-slot heights (mm). Length ≤ rows.
 *                                    If undefined/empty, all rows split equally.
 *                                    The LAST slot always auto-fills the leftover
 *                                    (whether user-set or computed) so the frame
 *                                    exactly matches `height`. If the user's
 *                                    provided heights can't fit, we throw.
 * @param {boolean} [params.topHingedBox]  If true, the topmost slot becomes a
 *                                    top-opening (chest-style) compartment
 *                                    with a hinged lid instead of a sliding
 *                                    drawer. When enabled, `topCap` is
 *                                    ignored (the lid IS the top).
 * @param {number} params.drawerWall  Drawer wall thickness, mm
 * @param {number} params.clearance   Per-side slide clearance, mm
 * @param {string} params.handleStyle "square-knob" | "arched-pull" | "square-pull" | "none"
 * @param {number} params.handleSize  Handle width (mm)
 * @param {boolean} params.feet       Add integral feet at the four corners
 * @param {number} params.footHeight  Feet height, mm
 * @param {number} params.footInset   Feet inset from outer corner, mm
 * @param {boolean} params.topCap     Add a detachable cap on top (ignored if topHingedBox)
 * @param {number} params.capThickness Cap thickness, mm
 * @param {number} params.capOverhang Cap overhang past the frame, mm
 * @param {boolean} params.glideNubs  Add small nubs on drawer sides for smoother sliding
 * @param {boolean} params.biscuitJoints Add decorative biscuit-joint pockets on the front stiles
 * @param {number} params.cornerR     Outer corner radius for the cap + frame, mm
 * @returns {Promise<{
 *   parts: Array<{ id: string, label: string, geometry: THREE.BufferGeometry, bbox: {x:number,y:number,z:number}, color: string, assembledPos: [number,number,number] }>,
 *   info: { slotHeights: number[], frameH: number, effectiveHeight: number }
 * }>}
 */
export async function generateDrawerChest(params) {
  const wasm      = await getManifold();
  const W         = Math.max(30, +params.width       || 80);
  const D         = Math.max(30, +params.depth       || 60);
  const H         = Math.max(30, +params.height      || 100);
  const wall      = Math.max(1.5, +params.wall       || 3);
  const rows      = Math.max(1, Math.min(8, +params.rows || 3));
  const drawerWall= Math.max(1.2, +params.drawerWall || 2);
  const clearance = Math.max(0.2, +params.clearance  || 0.4);
  const handleStyle = ["square-knob", "arched-pull", "square-pull", "none"].includes(params.handleStyle) ? params.handleStyle : "square-knob";
  const handleSize= Math.max(6, +params.handleSize   || 15);
  const feet      = !!params.feet && (+params.footHeight >= 1);   // treat "0 height feet" as "no feet"
  const footHeight= Math.max(0, +params.footHeight   || 8);
  const footInset = Math.max(0, +params.footInset    || 4);
  const topHingedBox = !!params.topHingedBox;
  // Iter-151.12 — friction-fit detent on the lid's axle hole. Tightens
  // the through-hole on the LID knuckles ONLY (not the frame's) so the
  // hinge pin has a slight interference fit against the lid. Effect:
  // the lid holds any open angle (including ~110°) instead of falling
  // shut. 0.10 mm reduction pairs with the standard 2.00 mm pin the
  // designer recommends inserting into the printed hinge.
  const lidDetent = !!params.lidDetent;
  const lidAxleR = lidDetent ? Math.max(0.4, 2.20 / 2 - 0.05) : 2.20 / 2;
  // topHingedBox owns the top of the frame, so the detachable cap is
  // mutually exclusive with it.
  const topCap    = !!params.topCap && !topHingedBox;
  const capThickness = Math.max(1.5, +params.capThickness || 4);
  const capOverhang  = Math.max(0, +params.capOverhang    || 3);
  const glideNubs = !!params.glideNubs;
  const biscuitJoints = !!params.biscuitJoints;
  const gridfinityLocators = !!params.gridfinityLocators;
  // Full Gridfinity baseplate profile carved into each drawer floor.
  // Mutually exclusive with gridfinityLocators — if both are set, the
  // full baseplate wins (it's the strict superset visually).
  const gridfinityBaseplate = !!params.gridfinityBaseplate;
  // Sub-divider grid inside each drawer. Format: "NxM" e.g. "2x2", "3x3",
  // "1x2", "2x3". "none" disables.
  const subdivider = typeof params.subdivider === "string" ? params.subdivider : "none";
  const cornerR   = Math.max(0, +params.cornerR      || 0);

  // ─── FRAME dimensions ──────────────────────────────────────────────
  // The frame occupies the region between the feet and the (optional)
  // top cap or hinged lid. `H` is the user's requested TOTAL height
  // (feet floor → topmost feature), so we subtract feet + whatever's
  // on top so the frame section fits exactly.
  const feetH   = feet ? footHeight : 0;
  const capH    = topCap ? capThickness : 0;
  // Hinge lid thickness (kept in sync with the lid geometry below).
  const hingeLidThickness = Math.max(3, wall);
  const lidH    = topHingedBox ? hingeLidThickness : 0;
  const frameH  = H - feetH - capH - lidH;                 // vertical extent of the cabinet section
  if (frameH < 30) {
    throw new Error("Chest too short — need at least 30 mm of cabinet section above the feet + cap.");
  }
  const frameBottomZ = feetH;
  const frameTopZ    = frameBottomZ + frameH;

  // ─── Slot heights per row ─────────────────────────────────────────
  // The cabinet section holds `rows` slots separated by (rows+1) or
  // (rows) full-width horizontal dividers of thickness `wall`. If the
  // top slot is a hinged-lid compartment, we DROP the top divider
  // (since the lid closes it off from above), so there are only
  // `rows` dividers total (1 bottom + (rows-1) between + 0 top).
  const numDividers = topHingedBox ? rows : rows + 1;
  const totalDivider = wall * numDividers;
  const availableSlots = frameH - totalDivider;
  if (availableSlots < 10 * rows) {
    throw new Error(`Only ${availableSlots.toFixed(1)} mm available for ${rows} drawer slots — reduce rows, lower the wall thickness, or increase the outer height.`);
  }
  // Build per-slot height array from user input; the BOTTOM slot
  // (index 0) always auto-fills whatever's left. This means the top
  // slot — including a hinged-lid compartment — always honors the
  // user's exact number.
  const userHeights = Array.isArray(params.drawerHeights) ? params.drawerHeights : [];
  const slotHeights = new Array(rows).fill(0);
  let consumedAbove = 0;
  for (let i = rows - 1; i >= 1; i--) {                 // fill top→down, leaving slot 0 for auto
    const h = +userHeights[i];
    const eff = (Number.isFinite(h) && h > 0) ? h : (availableSlots / rows);
    slotHeights[i] = eff;
    consumedAbove += eff;
  }
  slotHeights[0] = availableSlots - consumedAbove;
  if (slotHeights[0] < 10) {
    throw new Error(`Only ${slotHeights[0].toFixed(1)} mm left for the bottom slot after allocating the drawer heights above. Reduce upper drawer heights or increase overall height.`);
  }
  for (let i = 0; i < rows; i++) {
    if (slotHeights[i] < 10) {
      throw new Error(`Drawer ${i + 1} is only ${slotHeights[i].toFixed(1)} mm tall — minimum is 10 mm.`);
    }
  }
  // Precompute slot-start Z (the Z of each slot's floor, above its divider).
  // Layout bottom-to-top:  [wall divider] [slot 0] [wall divider] [slot 1] ... [slot rows-1] [optional top wall]
  const slotStartZ = new Array(rows);
  {
    let z = frameBottomZ + wall;                          // top of bottom divider
    for (let i = 0; i < rows; i++) {
      slotStartZ[i] = z;
      z += slotHeights[i];
      if (i < rows - 1) z += wall;                        // internal dividers between slots
    }
  }
  const slotInnerW = W - 2 * wall;

  // Hinge geometry constants (shared between the frame carving and the
  // hinged-lid part builder below).
  //
  // Iter-151.11 bug fix: The drawer FRONTS in this generator live at
  // world +Y (drawers are shifted forward by `D/2 - drawerTotalD/2` so
  // their local +Y face lands at +D/2). The hinged lid must therefore
  // pivot from the OPPOSITE side (-D/2 = back of the chest) so the lid
  // opens away from the user, not into the drawer stack. Prior to this
  // fix the hinges landed at +D/2 (same side as the drawer handles),
  // giving the lid a front-of-chest pivot — visually and physically
  // wrong. See user report 2026-07-21.
  const knuckleR    = Math.max(2.6, hingeLidThickness * 0.9);
  const axleR       = 2.20 / 2;
  const numKnuckles = 5;
  const knuckleGap  = 0.4;
  const knuckleY    = -D / 2 - knuckleR;                   // back of chest (opposite drawer faces)
  // Iter-151.28 — Hinge axis raised to sit ABOVE the frame's top plane.
  // Previously the axis was at `frameTopZ + hingeLidThickness / 2` (the
  // vertical MID-line of the lid slab), which meant the lid's back-
  // bottom edge had to swing DOWNWARD through the frame's top surface
  // to close — a hard geometric interference on the printed part.
  // User reported the lid springs back open when released (2026-07-22).
  //
  // New rule: knuckle centre = frameTopZ + knuckleR, so the knuckle
  // BOTTOM is flush with the frame top and the axis clears every point
  // on the lid during a full 0-100° rotation:
  //   - closed: lid's back-bottom sits exactly at (Y=-D/2, Z=frameTopZ)
  //     — no drop through the frame top.
  //   - opening: back-bottom traces an arc whose min Z equals frameTopZ
  //     (touches but doesn't intersect); everywhere else stays above.
  //   - fully open (~90-100°): back-bottom clears behind the box.
  // Trade-off: the knuckle now protrudes ~knuckleR above the lid's top
  // surface, which reads as an intentional piano-hinge detail.
  const knuckleZ    = frameTopZ + knuckleR;                // hinge axis level with knuckle centre; knuckle base flush with frame top

  // ─── Build the FRAME (cabinet) ─────────────────────────────────────
  let frameM;
  {
    // Outer block spans feet + cabinet.
    const outer = _weld(_roundedSlab(W, D, feetH + frameH, cornerR));
    outer.translate(0, 0, (feetH + frameH) / 2);
    frameM = _geomToMesh(wasm, outer);

    if (feet) {
      // Clear the entire feet Z-band, then union in four inset corner posts.
      const footSize = Math.max(6, Math.min(W / 3, D / 3, 14));
      const cutter = new THREE.BoxGeometry(W + 2, D + 2, feetH + 0.5);
      cutter.translate(0, 0, feetH / 2 - 0.1);
      const cm = _geomToMesh(wasm, _weld(cutter));
      const cleared = wasm.Manifold.difference([frameM, cm]);
      frameM.delete(); cm.delete();
      frameM = cleared;
      const postCX = W / 2 - footInset - footSize / 2;
      const postCY = D / 2 - footInset - footSize / 2;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const post = new THREE.BoxGeometry(footSize, footSize, feetH + 0.4);
        post.translate(sx * postCX, sy * postCY, feetH / 2 + 0.2);
        const pm = _geomToMesh(wasm, _weld(post));
        const merged = wasm.Manifold.union([frameM, pm]);
        frameM.delete(); pm.delete();
        frameM = merged;
      }
    }

    // ── Drawer / hinged-box slot cavities ──────────────────────────
    // For a drawer slot: carve a Y-through cavity so the front is open.
    // For the hinged-box slot (top row when enabled): carve a Z-through
    // cavity so the TOP is open; front is CLOSED (leave the front wall).
    const cavityFrontOver = 1;
    const drawerCavityY = D - wall + cavityFrontOver;
    const drawerCavityYCentre = -D / 2 + wall + drawerCavityY / 2;
    const boxInteriorD = D - 2 * wall;                    // hinged-box front + back walls
    const boxCavityYCentre = 0;

    for (let i = 0; i < rows; i++) {
      const startZ = slotStartZ[i];
      const sH = slotHeights[i];
      const isHingedBoxSlot = topHingedBox && i === rows - 1;
      if (isHingedBoxSlot) {
        // Z-through cavity: from slot floor up through the frame top.
        const cavZ = sH + 1;                              // over-cut 1 mm past top
        const cav = new THREE.BoxGeometry(slotInnerW, boxInteriorD, cavZ);
        cav.translate(0, boxCavityYCentre, startZ + sH / 2 + 0.5);
        const m = _geomToMesh(wasm, _weld(cav));
        const carved = wasm.Manifold.difference([frameM, m]);
        frameM.delete(); m.delete();
        frameM = carved;
      } else {
        const cav = new THREE.BoxGeometry(slotInnerW, drawerCavityY, sH);
        cav.translate(0, drawerCavityYCentre, startZ + sH / 2);
        const m = _geomToMesh(wasm, _weld(cav));
        const carved = wasm.Manifold.difference([frameM, m]);
        frameM.delete(); m.delete();
        frameM = carved;
      }
    }

    // ── Biscuit-joint pockets on the front stiles ──────────────────
    // Only cut biscuits on dividers that HAVE a front face (i.e. not
    // above/below hinged-box slots where the front is a wall, not a
    // divider stile). We put one biscuit per DRAWER slot boundary.
    if (biscuitJoints) {
      const biscuitLen = Math.min(wall * 1.5, 8);
      const biscuitH   = Math.max(1.5, wall * 0.6);
      const biscuitDepth = 1.0;
      // Divider Z positions: below-of-slot-0 (bottom of cabinet) through
      // above-of-slot-(rows-1) (top of cabinet). Skip the top divider
      // for hinged-box mode since there's no divider there.
      const numDividerLines = topHingedBox ? rows : rows + 1;
      let zCursor = frameBottomZ + wall / 2;
      const dividerZs = [zCursor];
      for (let i = 0; i < rows - 1; i++) {
        zCursor += wall / 2 + slotHeights[i] + wall / 2;
        dividerZs.push(zCursor);
      }
      if (!topHingedBox) {
        zCursor += wall / 2 + slotHeights[rows - 1] + wall / 2;
        dividerZs.push(zCursor);
      }
      for (let idx = 0; idx < Math.min(numDividerLines, dividerZs.length); idx++) {
        const dividerZ = dividerZs[idx];
        for (const sx of [-1, 1]) {
          const b = new THREE.BoxGeometry(biscuitLen, biscuitDepth * 2, biscuitH);
          b.translate(sx * (W / 2 - wall / 2), -D / 2 + biscuitDepth, dividerZ);
          const m = _geomToMesh(wasm, _weld(b));
          const carved = wasm.Manifold.difference([frameM, m]);
          frameM.delete(); m.delete();
          frameM = carved;
        }
      }
    }

    // ── Frame-side hinge knuckles (only when top compartment is hinged) ─
    if (topHingedBox) {
      const kSegLen = (W - 2) / numKnuckles;
      for (let i = 0; i < numKnuckles; i += 2) {           // frame owns evens: 0, 2, 4
        const xCenter = -W / 2 + 1 + (i + 0.5) * kSegLen;
        const kLen = kSegLen - knuckleGap;
        const kn = new THREE.CylinderGeometry(knuckleR, knuckleR, kLen, 24);
        kn.rotateZ(Math.PI / 2);
        kn.translate(xCenter, knuckleY, knuckleZ);
        const knM = _geomToMesh(wasm, _weld(kn));
        const merged = wasm.Manifold.union([frameM, knM]);
        frameM.delete(); knM.delete();
        frameM = merged;
        // Rib welding the knuckle back into the frame's rear wall.
        // Iter-151.11: back wall is at -D/2 (hinges live at -D/2).
        const rib = new THREE.BoxGeometry(kLen, knuckleR + 0.5, knuckleR * 2);
        rib.translate(xCenter, -D / 2 - (knuckleR + 0.5) / 2 + 0.2, knuckleZ - knuckleR);
        const ribM = _geomToMesh(wasm, _weld(rib));
        const merged2 = wasm.Manifold.union([frameM, ribM]);
        frameM.delete(); ribM.delete();
        frameM = merged2;
      }
      // Single axle hole through the whole knuckle row.
      const axle = new THREE.CylinderGeometry(axleR, axleR, W + 4, 20);
      axle.rotateZ(Math.PI / 2);
      axle.translate(0, knuckleY, knuckleZ);
      const axleM = _geomToMesh(wasm, _weld(axle));
      const carved = wasm.Manifold.difference([frameM, axleM]);
      frameM.delete(); axleM.delete();
      frameM = carved;

      // Iter-151.22 — Frame-side hinge stop bar (kickstand).
      // A rigid tab welded across the full hinge row on the FRAME
      // side, protruding radially from the knuckle axis at angle β
      // (measured CCW from +Y in the YZ plane, viewed from +X). The
      // LID-side stop tabs (added on each lid knuckle below) rotate
      // with the lid; when the lid swings open they sweep upward and
      // impact this bar, forming a positive hard stop at the user-
      // chosen `lidKickstandAngle` (default 100°) that doesn't depend
      // on friction. Bar sits BEHIND-and-ABOVE the hinge in the
      // closed position, so it doesn't interfere with the lid or the
      // interior of the chest.
      //
      // Iter-151.23 — angle is now user-adjustable. β_frame is
      // solved from θ_stop so the two rectangular tabs collide at
      // exactly the requested angle:
      //   β_frame = θ_stop + 2·halfAng
      // where halfAng ≈ atan((kickTabTan/2) / rCentre) is the angular
      // half-width of one tab at its centre radius.
      if (params.lidKickstand) {
        const kickTabExt = 3.0;                          // radial protrusion (mm)
        const kickTabTan = 2.0;                          // tangential thickness (mm)
        const kickBarLen = W - 2;                        // span across the full hinge row
        const rCentre = knuckleR + kickTabExt / 2;
        const halfAngDeg = (Math.atan((kickTabTan / 2) / rCentre) * 180) / Math.PI;
        const stopAngleDeg = Math.min(140, Math.max(85, +params.lidKickstandAngle || 100));
        const kickStopAngleDeg = stopAngleDeg + 2 * halfAngDeg;
        const bar = new THREE.BoxGeometry(kickBarLen, kickTabTan, kickTabExt);
        bar.translate(0, 0, rCentre);
        bar.rotateX(((kickStopAngleDeg - 90) * Math.PI) / 180);
        bar.translate(0, knuckleY, knuckleZ);
        const barM = _geomToMesh(wasm, _weld(bar));
        const stopped = wasm.Manifold.union([frameM, barM]);
        frameM.delete(); barM.delete();
        frameM = stopped;
      }
    }
  }

  const frameGeom = _manifoldToGeom(frameM);
  const frameBbox = _bbox(frameGeom);
  frameM.delete();

  // ─── DRAWERS ───────────────────────────────────────────────────────
  const drawerParts = [];
  {
    const drawerBackClearance = clearance;
    const drawerFaceThickness = Math.max(2.5, drawerWall * 1.6);
    const drawerTotalD = D - wall - drawerBackClearance;
    const drawerBodyD = drawerTotalD - drawerFaceThickness;

    for (let i = 0; i < rows; i++) {
      if (topHingedBox && i === rows - 1) continue;       // top slot has NO drawer
      const sH = slotHeights[i];
      const drawerW = slotInnerW - 2 * clearance;
      const drawerH = sH - 2 * clearance;
      // Effective drawer FLOOR thickness. Normally the same as
      // `drawerWall`, but the full Gridfinity baseplate pocket is
      // 3.75 mm deep, so we auto-bump the floor to 5 mm when the
      // baseplate is enabled — otherwise the cavity would punch
      // through the drawer's underside.
      const floorTh = gridfinityBaseplate ? Math.max(drawerWall, 5) : drawerWall;
      let drawerM;
      {
        const outer = _weld(_roundedSlab(drawerW, drawerTotalD, drawerH, Math.max(0, cornerR - wall)));
        outer.translate(0, 0, drawerH / 2);
        drawerM = _geomToMesh(wasm, outer);

        const cavW = drawerW - 2 * drawerWall;
        const cavH = drawerH - floorTh;
        const cavD = drawerBodyD - drawerWall;
        if (cavW > 2 && cavH > 2 && cavD > 2) {
          const cav = new THREE.BoxGeometry(cavW, cavD, cavH);
          const cavYCentre = drawerTotalD / 2 - drawerFaceThickness - cavD / 2;
          cav.translate(0, cavYCentre, floorTh + cavH / 2);
          const m = _geomToMesh(wasm, _weld(cav));
          const carved = wasm.Manifold.difference([drawerM, m]);
          drawerM.delete(); m.delete();
          drawerM = carved;
        }

        // ── Handle (attached to drawer front face) ─────────────────
        // All handles are UNIONED onto the drawer face (no through-holes).
        // Each style is one to three welded THREE primitives translated
        // into place at Y = +drawerTotalD/2 (drawer front) so the
        // handle protrudes forward.
        //
        // The `_addToDrawer` helper welds a THREE.Geometry into the
        // drawer manifold via a union step.
        const _addToDrawer = (geom) => {
          const m = _geomToMesh(wasm, _weld(geom));
          const merged = wasm.Manifold.union([drawerM, m]);
          drawerM.delete(); m.delete();
          drawerM = merged;
        };
        const faceY = drawerTotalD / 2;              // world-Y of drawer's front outer face (local drawer frame)
        const handleCentreZ = drawerH / 2;
        if (handleStyle === "square-knob") {
          // Reference: "Square knob" (see attached hardware image, left panel)
          // Squared knob composed of: base plate → narrow neck → wider cap.
          const size = Math.max(6, Math.min(handleSize, drawerW * 0.35, drawerH * 0.7));
          const basePlate = new THREE.BoxGeometry(size, 2, size);
          basePlate.translate(0, faceY + 1, handleCentreZ);
          _addToDrawer(basePlate);
          const neckSize = size * 0.55;
          const neck = new THREE.BoxGeometry(neckSize, 3, neckSize);
          neck.translate(0, faceY + 2 + 1.5, handleCentreZ);
          _addToDrawer(neck);
          const capSize = size * 0.85;
          const cap = new THREE.BoxGeometry(capSize, 5, capSize);
          cap.translate(0, faceY + 5 + 2.5, handleCentreZ);
          _addToDrawer(cap);
        } else if (handleStyle === "arched-pull") {
          // Reference: "Arched pull" (attached hardware image, centre panel)
          // Two flared footplates on the face + two tapered posts + a
          // horizontal cross-bar spanning between them.
          const span = Math.max(20, Math.min(handleSize * 2.2, drawerW - 12));
          const footW = Math.max(6, Math.min(12, span * 0.22));
          const footH = 2;
          const postW = footW * 0.55;
          const postH = 5;
          const barX = span;
          const barZ = 3.5;
          const barY = 3.5;
          for (const sx of [-1, 1]) {
            const foot = new THREE.BoxGeometry(footW, footH, footW);
            foot.translate(sx * span / 2, faceY + footH / 2, handleCentreZ);
            _addToDrawer(foot);
            const post = new THREE.BoxGeometry(postW, postH, postW);
            post.translate(sx * span / 2, faceY + footH + postH / 2, handleCentreZ);
            _addToDrawer(post);
          }
          // Cross-bar bridging the two posts (top of handle).
          const bar = new THREE.BoxGeometry(barX + postW, barY, barZ);
          bar.translate(0, faceY + footH + postH + barY / 2 - 0.3, handleCentreZ);
          _addToDrawer(bar);
        } else if (handleStyle === "square-pull") {
          // Reference: "Square U-pull" (attached hardware image, right panel)
          // Chunkier squared version — two square posts joined by a
          // square-section cross-bar with sharp corners.
          const span = Math.max(20, Math.min(handleSize * 2.2, drawerW - 12));
          const postXY = Math.max(5, Math.min(8, span * 0.14));      // post cross-section (square)
          const footXY = postXY + 2;                                 // footplate slightly wider
          const footH = 1.6;
          const postH = 6;
          const barY = postXY;
          const barZ = postXY;
          for (const sx of [-1, 1]) {
            const foot = new THREE.BoxGeometry(footXY, footH, footXY);
            foot.translate(sx * span / 2, faceY + footH / 2, handleCentreZ);
            _addToDrawer(foot);
            const post = new THREE.BoxGeometry(postXY, postH, postXY);
            post.translate(sx * span / 2, faceY + footH + postH / 2, handleCentreZ);
            _addToDrawer(post);
          }
          // Straight square cross-bar
          const bar = new THREE.BoxGeometry(span + postXY, barY, barZ);
          bar.translate(0, faceY + footH + postH - barY / 2 + barY / 2, handleCentreZ);
          _addToDrawer(bar);
        }
        // handleStyle === "none" → no handle added.

        if (glideNubs) {
          const nubR = Math.min(0.5, clearance * 0.9);
          const nubXs = [drawerW * 0.35, -drawerW * 0.35];
          const nubYs = [drawerTotalD * 0.25, -drawerTotalD * 0.25];
          for (const x of nubXs) {
            for (const y of nubYs) {
              const nub = new THREE.SphereGeometry(nubR, 12, 8);
              nub.translate(x, y, 0);
              const m = _geomToMesh(wasm, _weld(nub));
              const merged = wasm.Manifold.union([drawerM, m]);
              drawerM.delete(); m.delete();
              drawerM = merged;
            }
          }
        }

        // ── Gridfinity locators / baseplate / sub-divider ──────────
        // Cavity extents (used by all three interior features).
        const cavXHalf = (drawerW - 2 * drawerWall) / 2;
        const cavDInterior = drawerBodyD - drawerWall;
        const cavInteriorYCentre = drawerTotalD / 2 - drawerFaceThickness - cavDInterior / 2;
        const cavYFront  = cavInteriorYCentre + cavDInterior / 2;
        const cavYBack   = cavInteriorYCentre - cavDInterior / 2;
        const floorTopZ = floorTh;

        // Gridfinity FULL BASEPLATE — the exact bin-cavity profile
        // (approximated as 3 stacked rounded-square slabs matching
        // the canonical Zack Freedman spec):
        //    z = [-0.8, 0]      41.5 × 41.5 mm  r = 4.0  (straight top)
        //    z = [-2.95, -0.8]  39.0 × 39.0 mm  r = 3.0  (chamfer step)
        //    z = [-3.75, -2.95] 35.6 × 35.6 mm  r = 1.85 (straight bottom)
        // Pocket depth = 3.75 mm. Requires drawer floor ≥ 5 mm (auto).
        // Overrides the "locators (crosses)" option when both are on.
        if (gridfinityBaseplate) {
          const GF = 42;
          const nx = Math.floor((cavXHalf * 2) / GF);
          const ny = Math.floor((cavYFront - cavYBack) / GF);
          if (nx >= 1 && ny >= 1) {
            const xStart = -nx * GF / 2;
            // Baseplate PROFILE (top-of-floor is z=floorTopZ; carve DOWN).
            const layers = [
              { size: 41.5, r: 4.0,  h: 0.8,  centre: floorTopZ - 0.4                  },
              { size: 39.0, r: 3.0,  h: 2.15, centre: floorTopZ - 0.8 - 1.075          },
              { size: 35.6, r: 1.85, h: 0.8,  centre: floorTopZ - 2.95 - 0.4           },
            ];
            for (let ix = 0; ix < nx; ix++) {
              for (let iy = 0; iy < ny; iy++) {
                const cx = xStart + ix * GF + GF / 2;
                const cy = cavYFront - iy * GF - GF / 2;
                for (const L of layers) {
                  const slab = _weld(_roundedSlab(L.size, L.size, L.h, L.r));
                  slab.translate(cx, cy, L.centre);
                  const m = _geomToMesh(wasm, slab);
                  const carved = wasm.Manifold.difference([drawerM, m]);
                  drawerM.delete(); m.delete();
                  drawerM = carved;
                }
              }
            }
          }
        } else if (gridfinityLocators) {
          // Small "+" crosses at 42 mm grid intersections. Centred on X,
          // front-aligned on Y (user spec). Cells that don't fully fit
          // are dropped and crosses too close to a wall are skipped.
          const GF_CELL = 42;
          const armLen = 10;
          const armThk = 2.5;
          const armH   = 2;
          const nx = Math.floor((cavXHalf * 2) / GF_CELL);
          const ny = Math.floor((cavYFront - cavYBack) / GF_CELL);
          if (nx >= 1 && ny >= 1) {
            const xStart = -nx * GF_CELL / 2;
            for (let ix = 0; ix <= nx; ix++) {
              for (let iy = 0; iy <= ny; iy++) {
                const x = xStart + ix * GF_CELL;
                const y = cavYFront - iy * GF_CELL;
                if (Math.abs(x) > cavXHalf - 2) continue;
                if (y > cavYFront - 0.5 || y < cavYBack + 0.5) continue;
                const hArm = new THREE.BoxGeometry(armLen, armThk, armH);
                hArm.translate(x, y, floorTopZ + armH / 2);
                _addToDrawer(hArm);
                const vArm = new THREE.BoxGeometry(armThk, armLen, armH);
                vArm.translate(x, y, floorTopZ + armH / 2);
                _addToDrawer(vArm);
              }
            }
          }
        }

        // Sub-divider — N×M grid of interior walls that split the
        // drawer cavity into cubbies. Independent of Gridfinity —
        // both can be combined if the user wants Gridfinity locators
        // inside individual cubbies.
        if (subdivider !== "none" && /^\d+x\d+$/.test(subdivider)) {
          const [subX, subY] = subdivider.split("x").map(Number);
          const wallTh = drawerWall;
          const wallTop = drawerH - 1;                 // leave 1 mm below drawer rim
          const wallH  = wallTop - floorTopZ;
          if (wallH > 3) {
            const cavW = 2 * cavXHalf;
            // Y-parallel walls (along Y axis) divide X into `subX` columns.
            for (let i = 1; i < subX; i++) {
              const x = -cavXHalf + (i * cavW / subX);
              const wall = new THREE.BoxGeometry(wallTh, cavDInterior, wallH);
              wall.translate(x, cavInteriorYCentre, floorTopZ + wallH / 2);
              _addToDrawer(wall);
            }
            // X-parallel walls divide Y into `subY` rows.
            for (let j = 1; j < subY; j++) {
              const y = cavYBack + (j * cavDInterior / subY);
              const wall = new THREE.BoxGeometry(cavW, wallTh, wallH);
              wall.translate(0, y, floorTopZ + wallH / 2);
              _addToDrawer(wall);
            }
          }
        }
      }

      const drawerGeom = _manifoldToGeom(drawerM);
      drawerM.delete();
      const drawerAssembledY = D / 2 - drawerTotalD / 2;
      const drawerAssembledZ = slotStartZ[i] + clearance;
      drawerGeom.userData = { assembledPos: [0, drawerAssembledY, drawerAssembledZ] };
      const drawerBbox = _bbox(drawerGeom);
      drawerParts.push({
        id: `drawer-${i + 1}`,
        label: `Drawer ${i + 1}`,
        geometry: drawerGeom,
        bbox: drawerBbox,
        color: "#F97316",
        assembledPos: [0, drawerAssembledY, drawerAssembledZ],
      });
    }
  }

  // ─── HINGED LID (top compartment) ─────────────────────────────────
  let hingedLidPart = null;
  if (topHingedBox) {
    let lidM;
    // Lid outer slab — same footprint as the frame's top face.
    const lidSlab = _weld(_roundedSlab(W, D, hingeLidThickness, cornerR));
    lidSlab.translate(0, 0, hingeLidThickness / 2);
    lidM = _geomToMesh(wasm, lidSlab);

    // Lid-side knuckles: indices 1, 3 (odds) interlock with the frame's evens.
    const kSegLen = (W - 2) / numKnuckles;
    // Iter-151.28 — Axle centre raised to sit just above the frame's
    // top plane so the lid can close cleanly without swinging its
    // back-bottom edge THROUGH the frame's top surface. See the
    // matching frame-side comment where `knuckleZ` is defined.
    // In lid-local coordinates the lid slab's bottom face is Z=0, and
    // the world lid is placed at Z=frameTopZ; so lidKnuckleZ = knuckleR
    // makes the local axis land at world Z = frameTopZ + knuckleR,
    // matching the frame side exactly.
    const lidKnuckleZ = knuckleR;
    for (let i = 1; i < numKnuckles; i += 2) {
      const xCenter = -W / 2 + 1 + (i + 0.5) * kSegLen;
      const kLen = kSegLen - knuckleGap;
      const kn = new THREE.CylinderGeometry(knuckleR, knuckleR, kLen, 24);
      kn.rotateZ(Math.PI / 2);
      kn.translate(xCenter, knuckleY, lidKnuckleZ);
      const knM = _geomToMesh(wasm, _weld(kn));
      const merged = wasm.Manifold.union([lidM, knM]);
      lidM.delete(); knM.delete();
      lidM = merged;
      // Rib welding knuckle to the lid's back edge (iter-151.11: back = -D/2).
      // Iter-151.28 — rib now runs DOWNWARD from the knuckle to the
      // lid's underside so the raised axle is still solidly bonded to
      // the lid material.  Rib centre Y sits behind the back wall; rib
      // Z spans from just above the knuckle base (avoids z-fighting)
      // down to the lid's underside at Z=0.
      const ribH = Math.max(hingeLidThickness, knuckleR + 0.5);
      const rib = new THREE.BoxGeometry(kLen, knuckleR + 0.5, ribH);
      rib.translate(
        xCenter,
        -D / 2 - (knuckleR + 0.5) / 2 + 0.2,
        ribH / 2  // rib bottom flush with lid underside (local Z=0)
      );
      const ribM = _geomToMesh(wasm, _weld(rib));
      const merged2 = wasm.Manifold.union([lidM, ribM]);
      lidM.delete(); ribM.delete();
      lidM = merged2;
    }
    // Axle hole through the lid knuckle row.
    // Iter-151.12: uses `lidAxleR` (0.05 mm tighter when lidDetent is on)
    // so the pin friction-fits into the lid and holds any open angle.
    const axle = new THREE.CylinderGeometry(lidAxleR, lidAxleR, W + 4, 20);
    axle.rotateZ(Math.PI / 2);
    axle.translate(0, knuckleY, lidKnuckleZ);
    const axleM = _geomToMesh(wasm, _weld(axle));
    const carved = wasm.Manifold.difference([lidM, axleM]);
    lidM.delete(); axleM.delete();
    lidM = carved;

    // Small finger pull on the FRONT edge of the lid.
    // Iter-151.11: front = +D/2 (same side as drawer handles).
    const pullW = Math.min(24, W * 0.3);
    const pull = new THREE.BoxGeometry(pullW, 4, hingeLidThickness);
    pull.translate(0, D / 2 + 2 - 0.1, hingeLidThickness / 2);
    const pullM = _geomToMesh(wasm, _weld(pull));
    let merged = wasm.Manifold.union([lidM, pullM]);
    lidM.delete(); pullM.delete();
    lidM = merged;

    // Iter-151.22 — Lid-side hinge stop tabs (kickstand).
    // A radial tab on each LID knuckle at α=0° (pointing +Y from the
    // hinge axis, i.e. lying along the underside of the closed lid
    // and tucked inside the lid slab so it's invisible when closed).
    // As the lid rotates open, each tab sweeps up and impacts the
    // frame-side stop bar (added above at β=110°) at ~100° open,
    // providing a positive mechanical hard stop.
    if (params.lidKickstand) {
      const kickTabExt = 3.0;                            // radial protrusion (mm)
      const kickTabTan = 2.0;                            // tangential thickness (mm)
      const rCentre = knuckleR + kickTabExt / 2;
      for (let i = 1; i < numKnuckles; i += 2) {
        const xCenter = -W / 2 + 1 + (i + 0.5) * kSegLen;
        const kLen = kSegLen - knuckleGap;
        const tab = new THREE.BoxGeometry(kLen, kickTabTan, kickTabExt);
        tab.translate(0, 0, rCentre);
        // α = 0° (pointing +Y). Start box on +Z axis (angle 90°), rotate by -90°.
        tab.rotateX((-90 * Math.PI) / 180);
        tab.translate(xCenter, knuckleY, lidKnuckleZ);
        const tabM = _geomToMesh(wasm, _weld(tab));
        const withTab = wasm.Manifold.union([lidM, tabM]);
        lidM.delete(); tabM.delete();
        lidM = withTab;
      }
    }

    const lidGeom = _manifoldToGeom(lidM);
    lidM.delete();
    const lidBbox = _bbox(lidGeom);
    lidGeom.userData = { assembledPos: [0, 0, frameTopZ] };
    hingedLidPart = {
      id: "hinged-lid",
      label: "Hinged lid",
      geometry: lidGeom,
      bbox: lidBbox,
      color: "#06B6D4",
      assembledPos: [0, 0, frameTopZ],
    };
  }

  // ─── DETACHABLE TOP CAP ────────────────────────────────────────────
  let capPart = null;
  if (topCap) {
    const capW = W + 2 * capOverhang;
    const capD = D + 2 * capOverhang;
    const capGeom = _weld(_roundedSlab(capW, capD, capThickness, Math.max(cornerR, capOverhang * 0.5)));
    capGeom.translate(0, 0, capThickness / 2);
    capGeom.userData = { assembledPos: [0, 0, frameTopZ] };
    const capBbox = _bbox(capGeom);
    capPart = {
      id: "cap",
      label: "Top cap",
      geometry: capGeom,
      bbox: capBbox,
      color: "#06B6D4",
      assembledPos: [0, 0, frameTopZ],
    };
  }

  const parts = [
    { id: "frame", label: "Frame", geometry: frameGeom, bbox: frameBbox, color: "#94A3B8", assembledPos: [0, 0, 0] },
    ...drawerParts,
  ];
  if (hingedLidPart) parts.push(hingedLidPart);
  if (capPart) parts.push(capPart);

  // Compute volume for each part + total. Volume is the SOLID mesh
  // volume in mm³ (i.e. "100 % infill" material). The caller can
  // apply an infill factor to convert to real filament grams.
  let totalVolMm3 = 0;
  for (const p of parts) {
    p.volumeMm3 = _volumeMm3(p.geometry);
    totalVolMm3 += p.volumeMm3;
  }

  return {
    parts,
    info: {
      slotHeights: slotHeights.map((v) => +v.toFixed(2)),
      frameH: +frameH.toFixed(2),
      effectiveHeight: +(feetH + frameH + capH + lidH).toFixed(2),
      totalVolumeMm3: +totalVolMm3.toFixed(0),
    },
  };
}

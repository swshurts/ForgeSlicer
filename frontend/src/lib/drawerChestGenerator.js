/**
 * drawerChestGenerator — parametric CSG builder for a printable
 * multi-drawer chest / chest-of-drawers assembly.
 *
 * Produces separate manifolds for:
 *   - Frame (main cabinet, feet integral, drawer cavities cut out)
 *   - N drawers (each an open-top box with a front face + optional
 *     recessed handle + optional glide nubs)
 *   - Detachable top cap (optional)
 *
 * Coordinate frame: Z-up. Origin at floor-centre of the frame footprint.
 * All dimensions in millimetres.
 *
 * Mirrors the boxGenerator.js pattern — helpers are reused via named
 * exports so we stay DRY across the two parametric generators.
 */
import * as THREE from "three";
import { getManifold } from "./manifoldEngine";
import { _bbox, _weld, _geomToMesh, _manifoldToGeom, _roundedSlab } from "./boxGenerator";

/**
 * Build a full drawer-chest parts bundle.
 *
 * @param {object} params
 * @param {number} params.width       Outer width (X), mm
 * @param {number} params.depth       Outer depth (Y), mm
 * @param {number} params.height      Outer height (Z), mm (feet + cap included)
 * @param {number} params.wall        Frame wall thickness, mm
 * @param {number} params.rows        Number of drawers (stacked)
 * @param {number} params.drawerWall  Drawer wall thickness, mm
 * @param {number} params.clearance   Per-side slide clearance, mm
 * @param {string} params.handleStyle "recess" | "knob" | "none"
 * @param {number} params.handleSize  Handle width (mm)
 * @param {boolean} params.feet       Add integral feet at the four corners
 * @param {number} params.footHeight  Feet height, mm
 * @param {number} params.footInset   Feet inset from outer corner, mm
 * @param {boolean} params.topCap     Add a detachable cap on top
 * @param {number} params.capThickness Cap thickness, mm
 * @param {number} params.capOverhang Cap overhang past the frame, mm
 * @param {boolean} params.glideNubs  Add small nubs on drawer sides for smoother sliding
 * @param {boolean} params.biscuitJoints Add decorative biscuit-joint pockets on the front stiles
 * @param {number} params.cornerR     Outer corner radius for the cap + frame, mm
 * @returns {Promise<{ parts: Array<{ id: string, label: string, geometry: THREE.BufferGeometry, bbox: {x:number,y:number,z:number}, color: string }> }>}
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
  const handleStyle = ["recess", "knob", "none"].includes(params.handleStyle) ? params.handleStyle : "recess";
  const handleSize= Math.max(6, +params.handleSize   || 15);
  const feet      = !!params.feet;
  const footHeight= Math.max(0, +params.footHeight   || 8);
  const footInset = Math.max(0, +params.footInset    || 4);
  const topCap    = !!params.topCap;
  const capThickness = Math.max(1.5, +params.capThickness || 4);
  const capOverhang  = Math.max(0, +params.capOverhang    || 3);
  const glideNubs = !!params.glideNubs;
  const biscuitJoints = !!params.biscuitJoints;
  const cornerR   = Math.max(0, +params.cornerR      || 0);

  // ─── FRAME dimensions ──────────────────────────────────────────────
  // The frame occupies the region between the feet and the (optional)
  // top cap. Feet are BUILT INTO the frame (subtract material between
  // them) so we still export a single frame part. The cap ships
  // separately so the user can print it in a different colour.
  const feetH   = feet ? footHeight : 0;
  const capH    = topCap ? capThickness : 0;
  const frameH  = H - feetH - capH;                        // vertical extent of the "cabinet" section
  if (frameH < 30) {
    throw new Error("Drawer chest height too small — need at least 30 mm of cabinet section above the feet + cap.");
  }
  // Frame body has its bottom at Z = 0 (feet start below at Z<0 if enabled).
  // Actually to keep everything on the print bed, we shift so
  // Z = 0 is the very bottom of the feet, then frameBottomZ = feetH,
  // frameTopZ = feetH + frameH.
  const frameBottomZ = feetH;
  const frameTopZ    = frameBottomZ + frameH;

  // ─── Build the FRAME (cabinet) ─────────────────────────────────────
  let frameM;
  {
    // Start with a solid outer block spanning the full height (feet + cabinet).
    // Feet are just legs at the four corners — everything BETWEEN the
    // corners in the feet-Z band gets cut away. If feet are disabled
    // the frame simply starts at Z=0.
    const outer = _weld(_roundedSlab(W, D, feetH + frameH, cornerR));
    outer.translate(0, 0, (feetH + frameH) / 2);
    frameM = _geomToMesh(wasm, outer);

    if (feet) {
      // Carve away the material between the four foot columns in the
      // 0..feetH Z-band. What's left is 4 corner posts.
      const footSize = Math.max(6, Math.min(W / 3, D / 3, 12));   // corner post edge length
      // Cutter for the -X strip between the two -X-face feet
      // Actually simplest: one big cutter covering the middle region
      // between the four corner squares. That's the "inner" X-Y area
      // extended past the ± footprint corners by (footInset + footSize).
      const feetInset = footInset;
      const cutW = W - 2 * (feetInset + footSize);
      const cutD = D - 2 * (feetInset + footSize);
      // Cross-shape cutter: two rectangles unioned
      if (cutW > 0.5) {
        const cutter1 = new THREE.BoxGeometry(cutW, D + 2, feetH + 0.5);
        cutter1.translate(0, 0, feetH / 2);
        const m = _geomToMesh(wasm, _weld(cutter1));
        const carved = wasm.Manifold.difference([frameM, m]);
        frameM.delete(); m.delete();
        frameM = carved;
      }
      if (cutD > 0.5) {
        const cutter2 = new THREE.BoxGeometry(W + 2, cutD, feetH + 0.5);
        cutter2.translate(0, 0, feetH / 2);
        const m = _geomToMesh(wasm, _weld(cutter2));
        const carved = wasm.Manifold.difference([frameM, m]);
        frameM.delete(); m.delete();
        frameM = carved;
      }
    }

    // ── Drawer cavities ─────────────────────────────────────────────
    // The cabinet interior has (rows) equally-sized drawer slots. Each
    // slot is separated from the next by a horizontal divider of
    // thickness (wall). The slot's outer envelope in Y-Z is
    //   Y: -D/2 + wall  →  D/2   (open to the front, wall on back only)
    //   Z: startZ       →  startZ + slotH
    // where slotH = (frameH - wall * (rows + 1)) / rows (rows+1 dividers
    // including top+bottom of the cabinet).
    const totalDivider = wall * (rows + 1);
    const slotH = (frameH - totalDivider) / rows;
    if (slotH < 10) {
      throw new Error(`Slot height only ${slotH.toFixed(1)} mm — reduce rows, lower the wall thickness, or increase the outer height.`);
    }
    const slotInnerW = W - 2 * wall;
    // Cavity Y range: from -D/2 + wall (back wall) to D/2 + 1 (open past front)
    const cavityY = D - wall + 2;   // over-cut past the front by 2 mm
    const cavityYCentre = -D / 2 + wall + cavityY / 2 - 1;

    for (let i = 0; i < rows; i++) {
      const slotStartZ = frameBottomZ + wall + i * (slotH + wall);
      const slotCentreZ = slotStartZ + slotH / 2;
      const cavity = new THREE.BoxGeometry(slotInnerW, cavityY, slotH);
      cavity.translate(0, cavityYCentre, slotCentreZ);
      const m = _geomToMesh(wasm, _weld(cavity));
      const carved = wasm.Manifold.difference([frameM, m]);
      frameM.delete(); m.delete();
      frameM = carved;
    }

    // ── Optional biscuit-joint pockets on the front stiles ─────────
    // Decorative half-elliptical pockets on the two front stiles that
    // suggest a mortise-and-tenon / biscuit-joint aesthetic. Cut about
    // 1 mm deep; positioned centered on each horizontal divider.
    if (biscuitJoints) {
      const biscuitLen = Math.min(wall * 1.5, 8);
      const biscuitH   = Math.max(1.5, wall * 0.6);
      const biscuitDepth = 1.0;
      for (let i = 0; i <= rows; i++) {
        const dividerZ = frameBottomZ + wall / 2 + i * (slotH + wall);
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
  }

  // ─── Extract frame geometry ────────────────────────────────────────
  const frameGeom = _manifoldToGeom(frameM);
  const frameBbox = _bbox(frameGeom);
  frameM.delete();

  // ─── DRAWERS ───────────────────────────────────────────────────────
  const drawerParts = [];
  {
    const totalDivider = wall * (rows + 1);
    const slotH = (frameH - totalDivider) / rows;
    const slotInnerW = W - 2 * wall;
    const slotInnerD = D - wall;

    // Drawer outer envelope: shrink from the slot by `clearance` on all
    // free faces (top, bottom, left, right, back). Front is FLUSH with
    // the frame's front (drawer face sits proud of the cavity mouth).
    const drawerW = slotInnerW - 2 * clearance;
    const drawerH = slotH - 2 * clearance;
    const drawerBackClearance = clearance;
    const drawerFaceThickness = Math.max(2.5, drawerWall * 1.6);    // thicker front face
    // Drawer overall depth = slot depth + face thickness (face sits proud past front by drawerFaceThickness - clearance)
    const drawerBodyD = slotInnerD - drawerBackClearance;           // depth of the drawer's cavity + walls
    const drawerTotalD = drawerBodyD + drawerFaceThickness - clearance;

    for (let i = 0; i < rows; i++) {
      // Build drawer geometry with its origin at drawer's front-bottom-left corner.
      // We'll express it in a local frame first, then translate to fit inside the slot.
      let drawerM;
      {
        // Outer shell — a rounded slab, hollowed.
        const outer = _weld(_roundedSlab(drawerW, drawerTotalD, drawerH, Math.max(0, cornerR - wall)));
        outer.translate(0, 0, drawerH / 2);
        drawerM = _geomToMesh(wasm, outer);

        // Hollow: cut an interior box. Interior width & height are
        // (outer - 2 * drawerWall), interior depth ends
        // (drawerFaceThickness) short of the front face.
        const cavW = drawerW - 2 * drawerWall;
        const cavH = drawerH - drawerWall;                          // keep a floor
        const cavD = drawerBodyD - drawerWall;                      // keep a back
        if (cavW > 2 && cavH > 2 && cavD > 2) {
          const cav = new THREE.BoxGeometry(cavW, cavD, cavH);
          // Position: cavity front stops (drawerFaceThickness) mm short of the drawer's front face.
          // In local frame, drawer runs Y: -drawerTotalD/2 (back) .. +drawerTotalD/2 (front).
          // Cavity centred at Y = drawerTotalD/2 - drawerFaceThickness - cavD/2
          const cavYCentre = drawerTotalD / 2 - drawerFaceThickness - cavD / 2;
          cav.translate(0, cavYCentre, drawerWall + cavH / 2);
          const m = _geomToMesh(wasm, _weld(cav));
          const carved = wasm.Manifold.difference([drawerM, m]);
          drawerM.delete(); m.delete();
          drawerM = carved;
        }

        // Handle — recess (finger pull) or protruding knob.
        if (handleStyle === "recess") {
          const rH = Math.min(handleSize * 0.6, drawerH * 0.5);
          const rW = Math.min(handleSize, drawerW * 0.5);
          const rD = drawerFaceThickness * 0.8;
          const recess = new THREE.BoxGeometry(rW, rD * 2, rH);
          recess.translate(
            0,
            drawerTotalD / 2 - rD + 0.1,     // sits in the front face
            drawerH / 2,                     // vertically centred
          );
          const m = _geomToMesh(wasm, _weld(recess));
          const carved = wasm.Manifold.difference([drawerM, m]);
          drawerM.delete(); m.delete();
          drawerM = carved;
        } else if (handleStyle === "knob") {
          const kR = Math.min(handleSize / 2, drawerH * 0.25);
          const knob = new THREE.CylinderGeometry(kR, kR, drawerFaceThickness * 1.5, 24);
          knob.rotateX(Math.PI / 2);   // Y→Z would be wrong here; we want cylinder axis along Y.
          // Actually cylinder default is Y-axis. We want it protruding forward (+Y).
          // So NO rotation needed — Y-axis IS forward.
          knob.rotateX(0);
          knob.translate(0, drawerTotalD / 2 + drawerFaceThickness * 0.35, drawerH / 2);
          const m = _geomToMesh(wasm, _weld(knob));
          const merged = wasm.Manifold.union([drawerM, m]);
          drawerM.delete(); m.delete();
          drawerM = merged;
        }

        // Glide nubs — 4 small hemispheres (or cylinders) on each side
        // of the drawer at bottom-mid, so the drawer rides on 4 small
        // points against the divider instead of a full face. Only if
        // enabled and only along the side walls' outer faces.
        if (glideNubs) {
          const nubR = 0.6;
          const nubY = [drawerTotalD * 0.25, -drawerTotalD * 0.25];  // ±25 % of length
          for (const sx of [-1, 1]) {
            for (const y of nubY) {
              const nub = new THREE.SphereGeometry(nubR, 12, 8);
              nub.translate(sx * drawerW / 2, y, nubR);              // sit on the drawer's Z=0 (bottom)
              const m = _geomToMesh(wasm, _weld(nub));
              const merged = wasm.Manifold.union([drawerM, m]);
              drawerM.delete(); m.delete();
              drawerM = merged;
            }
          }
        }
      }

      // Translate drawer to world position for the assembled preview.
      // In the assembled view the drawer sits inside the slot, with its
      // front face flush with the frame front.
      const drawerGeom = _manifoldToGeom(drawerM);
      drawerM.delete();

      const slotStartZ = frameBottomZ + wall + i * (slotH + wall);
      // Position the drawer in the assembled scene: X=0 (centred), Y so
      // front face is flush with frame front (drawer's local Y=+drawerTotalD/2
      // maps to frame's Y=+D/2), Z so drawer's local Z=0 is at slot start + clearance.
      const drawerAssembledY = D / 2 - drawerTotalD / 2;
      const drawerAssembledZ = slotStartZ + clearance;
      // For the individual-part export we DON'T want the assembled offset —
      // each drawer part exports at its own origin.
      // Store the assembled offset as `assembledPos` for the preview.
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

  // ─── DETACHABLE TOP CAP ────────────────────────────────────────────
  let capPart = null;
  if (topCap) {
    const capW = W + 2 * capOverhang;
    const capD = D + 2 * capOverhang;
    const capGeom = _weld(_roundedSlab(capW, capD, capThickness, Math.max(cornerR, capOverhang * 0.5)));
    capGeom.translate(0, 0, capThickness / 2);
    // NOTE: cap part exports at its own origin (Z=0..capThickness). The
    // assembled preview sits it on top of the frame.
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

  // ─── Return parts bundle ──────────────────────────────────────────
  const parts = [
    {
      id: "frame",
      label: "Frame",
      geometry: frameGeom,
      bbox: frameBbox,
      color: "#94A3B8",
      assembledPos: [0, 0, 0],
    },
    ...drawerParts,
  ];
  if (capPart) parts.push(capPart);
  return { parts };
}

// iter-105.5 — Universal heightmap source.
//
// Both built-in patterns AND user-uploaded images flow through this
// module and produce the same {hmap, RES, tileWidth} shape that the
// wrap engine in textureGeometry.js consumes. The pre-iter-105.4
// "build 3D pattern geometry → rasterise triangle BBs into a Y-axis
// heightmap" pipeline was buggy for sparse patterns (hex / bumps /
// diamond plate left ~85% of the heightmap empty because triangle
// AABBs over-fill empty space and under-fill the dense interiors of
// each shape). Drawing into a Canvas 2D context gives us
// per-pattern pixel accuracy AND lets the same code path serve
// user image uploads (PNG / JPG → grayscale heightmap).
//
// Brightness = height. Pure white = full `height` mm of relief.
// Pure black = 0 mm. Anti-aliased canvas edges turn into smooth
// ramps on the printed surface.
//
// iter-105.9 — bumped RES from 256→512 so user-uploaded portraits /
// logos / line art come through with enough detail to read on
// printed parts. The wrap mesh resolution was bumped in parallel so
// the heightmap → mesh sampling stays at roughly 1:1 (otherwise the
// extra heightmap detail would just get aliased back out).
//
// `tileWidth` is the physical width (mm) one heightmap-wrap covers.
// The wrap engine uses it to convert arc-length → UV, so a sphere
// of circumference C samples the heightmap C / tileWidth times
// around its equator. "Stretch" mode (one image fills the surface
// once) is implemented by the wrap engine itself overriding
// tileWidth — this module always emits a heightmap baked at its
// natural physical scale.

const RES = 512;

function _newCanvas() {
  const c = (typeof OffscreenCanvas !== "undefined")
    ? new OffscreenCanvas(RES, RES)
    : (() => { const el = document.createElement("canvas"); el.width = RES; el.height = RES; return el; })();
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, RES, RES);
  return { c, ctx };
}

function _canvasToHmap(ctx, heightMM, { invert = false } = {}) {
  const img = ctx.getImageData(0, 0, RES, RES);
  const data = img.data;
  const hmap = new Float32Array(RES * RES);
  // iter-105.9 — flip rows on read so heightmap row 0 corresponds to
  // the BOTTOM of the source image. The wrap engine's UV convention
  // is v=0 at the bottom of the surface (sphere south pole / cube
  // bottom edge / cylinder bottom). Without this flip, custom-image
  // textures came out upside-down (the user uploaded a portrait and
  // saw it inverted on the print).
  for (let y = 0; y < RES; y++) {
    const srcRow = (RES - 1 - y) * RES * 4;
    const dstRow = y * RES;
    for (let x = 0; x < RES; x++) {
      const si = srcRow + x * 4;
      // Standard luminance: 0.299 R + 0.587 G + 0.114 B (matches what a
      // grayscale-converted JPEG would look like, so user-uploaded
      // colour images behave intuitively).
      let lum = (0.299 * data[si] + 0.587 * data[si + 1] + 0.114 * data[si + 2]) / 255;
      if (invert) lum = 1 - lum;
      hmap[dstRow + x] = lum * heightMM;
    }
  }
  return hmap;
}

// ----------------------------------------------------------------------
// Built-in pattern renderers. Each takes a 2D context and the LOGICAL
// pattern size (in pixels) — typically the canvas is sized so 4 tiles
// fit, giving a smooth repeat when the heightmap tiles on the model.

function _drawBumps(ctx, tilePx) {
  // Dense hex-packed circles with radial gradient (white centre → black
  // edge) so each bump becomes a dome on the model (not a flat-topped
  // cylinder). Packed in a triangular lattice so adjacent bumps just
  // touch — gives ~90% coverage instead of the old sparse 12-15%.
  const r = tilePx * 0.5 * 0.96;
  const dx = tilePx;
  const dy = tilePx * Math.sqrt(3) / 2;
  for (let row = -1; row * dy < RES + dy; row++) {
    const cy = row * dy;
    const stagger = (row & 1) ? dx / 2 : 0;
    for (let col = -1; col * dx + stagger < RES + dx; col++) {
      const cx = col * dx + stagger;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.7, "#9a9a9a");
      g.addColorStop(1, "#000000");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function _drawHex(ctx, tilePx) {
  // Flat-top hex grid with a small mortar gap so adjacent hexes don't
  // merge into one big slab.
  const r = tilePx * 0.55 * 0.92;
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  ctx.fillStyle = "#ffffff";
  for (let row = -1; row * dy < RES + dy; row++) {
    const cy = row * dy;
    const stagger = (row & 1) ? dx / 2 : 0;
    for (let col = -1; col * dx + stagger < RES + dx; col++) {
      const cx = col * dx + stagger;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + Math.PI / 6;
        const px = cx + r * Math.cos(a);
        const py = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

function _drawHexCamo(ctx, tilePx) {
  // Same hex packing but each cell gets a randomised grey (deterministic
  // PRNG so the heightmap is reproducible across renders).
  const r = tilePx * 0.55 * 0.92;
  const dx = r * Math.sqrt(3);
  const dy = r * 1.5;
  let seed = 0x12345;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let row = -1; row * dy < RES + dy; row++) {
    const cy = row * dy;
    const stagger = (row & 1) ? dx / 2 : 0;
    for (let col = -1; col * dx + stagger < RES + dx; col++) {
      const cx = col * dx + stagger;
      const g = Math.round(120 + rng() * 135); // 120..255
      ctx.fillStyle = `rgb(${g},${g},${g})`;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + Math.PI / 6;
        ctx[i === 0 ? "moveTo" : "lineTo"](cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
      ctx.closePath();
      ctx.fill();
    }
  }
}

function _drawKnurlDiamond(ctx, tilePx) {
  // Classic tool-handle knurl — diagonal cross-hatched ridges. Draw
  // two sets of parallel diagonal lines, each tilePx apart, at ±45°.
  ctx.strokeStyle = "#ffffff";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, tilePx * 0.18);
  ctx.lineJoin = "round";
  const step = tilePx;
  for (let dir of [1, -1]) {
    ctx.beginPath();
    for (let off = -RES; off < 2 * RES; off += step) {
      ctx.moveTo(off, 0);
      ctx.lineTo(off + dir * RES, RES);
    }
    ctx.stroke();
  }
}

function _drawRidgesLinear(ctx, tilePx) {
  // Horizontal half-cylinder grooves — gradient bar per tile gives
  // a rounded ridge instead of a square bar.
  for (let y = 0; y < RES + tilePx; y += tilePx) {
    const g = ctx.createLinearGradient(0, y, 0, y + tilePx);
    g.addColorStop(0, "#000");
    g.addColorStop(0.5, "#fff");
    g.addColorStop(1, "#000");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, RES, tilePx);
  }
}

function _drawDiamondPlate(ctx, tilePx) {
  // Industrial floor tread — two diamond bars per tile rotated ±45°.
  const halfTile = tilePx / 2;
  ctx.fillStyle = "#ffffff";
  for (let row = 0; row * tilePx < RES + tilePx; row++) {
    for (let col = 0; col * tilePx < RES + tilePx; col++) {
      const cx = col * tilePx + halfTile;
      const cy = row * tilePx + halfTile;
      // Two crossed diamonds
      ctx.save();
      ctx.translate(cx, cy);
      for (let ang of [-Math.PI / 6, Math.PI / 6]) {
        ctx.save();
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0, -halfTile * 0.65);
        ctx.lineTo(halfTile * 0.22, 0);
        ctx.lineTo(0, halfTile * 0.65);
        ctx.lineTo(-halfTile * 0.22, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }
}

function _drawBrick(ctx, tilePx) {
  // Running-bond brick — wide rectangles with a 1.5px mortar gap.
  const brickW = tilePx;
  const brickH = tilePx * 0.5;
  const gap = Math.max(2, tilePx * 0.08);
  ctx.fillStyle = "#ffffff";
  for (let row = 0; row * brickH < RES + brickH; row++) {
    const stagger = (row & 1) ? brickW / 2 : 0;
    for (let col = -1; col * brickW + stagger < RES + brickW; col++) {
      const x = col * brickW + stagger + gap / 2;
      const y = row * brickH + gap / 2;
      ctx.fillRect(x, y, brickW - gap, brickH - gap);
    }
  }
}

function _drawFabric(ctx, tilePx) {
  // Basket weave — alternating warp/weft bars per cell, rounded with
  // a gradient so the relief looks like over-under threads.
  const cell = tilePx;
  for (let row = 0; row * cell < RES + cell; row++) {
    for (let col = 0; col * cell < RES + cell; col++) {
      const cx = col * cell + cell / 2;
      const cy = row * cell + cell / 2;
      const horiz = ((row + col) & 1) === 0;
      const g = horiz
        ? ctx.createLinearGradient(0, cy - cell / 2, 0, cy + cell / 2)
        : ctx.createLinearGradient(cx - cell / 2, 0, cx + cell / 2, 0);
      g.addColorStop(0, "#000");
      g.addColorStop(0.5, "#fff");
      g.addColorStop(1, "#000");
      ctx.fillStyle = g;
      if (horiz) ctx.fillRect(col * cell, cy - cell * 0.35, cell, cell * 0.7);
      else       ctx.fillRect(cx - cell * 0.35, row * cell, cell * 0.7, cell);
    }
  }
}

function _drawVoronoi(ctx, tilePx) {
  // Lloyd-relaxed-ish voronoi cells. Place ~36 seeds in the canvas
  // (deterministic), assign each pixel the index of its closest seed,
  // colour by distance to the cell boundary so the relief looks like
  // raised polygonal stones with mortar between.
  let seed = 0xbeef;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const tilesPerSide = Math.max(2, Math.round(RES / tilePx));
  const seeds = [];
  for (let i = 0; i < tilesPerSide * tilesPerSide; i++) {
    const gx = i % tilesPerSide, gy = Math.floor(i / tilesPerSide);
    seeds.push({
      x: (gx + 0.5 + (rng() - 0.5) * 0.6) * (RES / tilesPerSide),
      y: (gy + 0.5 + (rng() - 0.5) * 0.6) * (RES / tilesPerSide),
    });
  }
  const img = ctx.createImageData(RES, RES);
  const data = img.data;
  for (let py = 0; py < RES; py++) {
    for (let px = 0; px < RES; px++) {
      // Find d1 = closest seed dist, d2 = 2nd closest. Cell intensity =
      // (d2 - d1) — large in cell interiors (far from boundary), small
      // on boundaries.
      let d1 = Infinity, d2 = Infinity;
      for (const s of seeds) {
        const dx = s.x - px, dy = s.y - py;
        const d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; }
        else if (d < d2) { d2 = d; }
      }
      const v = Math.min(255, Math.max(0, (Math.sqrt(d2) - Math.sqrt(d1)) * 12));
      const idx = (py * RES + px) * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const _PATTERN_DRAWERS = {
  bumps: _drawBumps,
  hex: _drawHex,
  hex_camo: _drawHexCamo,
  knurl_diamond: _drawKnurlDiamond,
  ridges_linear: _drawRidgesLinear,
  diamond_plate: _drawDiamondPlate,
  brick: _drawBrick,
  fabric: _drawFabric,
  voronoi: _drawVoronoi,
};

/**
 * Build a heightmap for one of the built-in patterns.
 *
 * @param {string} pattern  pattern id, see TEXTURE_PATTERNS in textureGeometry
 * @param {number} tileSizeMM  physical size of one tile (mm)
 * @param {number} heightMM    max relief height (mm)
 * @returns {{hmap: Float32Array, RES: number, tileWidth: number} | null}
 */
export function buildPatternHeightmap(pattern, tileSizeMM, heightMM) {
  const drawer = _PATTERN_DRAWERS[pattern];
  if (!drawer) return null;
  const { c, ctx } = _newCanvas();
  // We size the canvas so ~4 tiles fit across — gives the wrap engine
  // a heightmap that's already past the pattern's period (so its
  // tiling join is invisible) and avoids per-pixel pattern aliasing.
  const tilesAcross = 4;
  const tilePx = RES / tilesAcross;
  drawer(ctx, tilePx);
  const hmap = _canvasToHmap(ctx, heightMM);
  // dispose canvas (OffscreenCanvas auto-collects; HTML canvas just GC'd).
  if (c && c.width !== undefined) c.width = 0;
  return { hmap, RES, tileWidth: tileSizeMM * tilesAcross };
}

/**
 * Convert a user-uploaded image into a heightmap.
 *
 * @param {string} imageSrc      data: URL or remote URL
 * @param {object} opts
 * @param {number} opts.heightMM relief height for full-white pixels
 * @param {number} opts.tileSizeMM  physical mm one canvas-tile covers
 * @param {boolean} opts.invert  flip light/dark before height mapping
 * @param {"tile"|"stretch"} opts.fitMode
 *      "tile":    image tile-repeats every tileSizeMM
 *      "stretch": image fills the whole canvas once (caller will then
 *                 ask the wrap engine to map one canvas across the
 *                 entire target surface — see textureGeometry).
 * @returns {Promise<{hmap, RES, tileWidth, fitMode}>}
 */
export function imageToHeightmap(imageSrc, opts) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const { c, ctx } = _newCanvas();
        const fit = opts.fitMode || "tile";
        if (fit === "tile") {
          // Render the source image into a small intermediate canvas
          // sized so it represents EXACTLY one tile (tileSizeMM), then
          // tile-fill the output canvas with that. This decouples
          // image-aspect from tile periodicity.
          const tilesAcross = 4;
          const tilePx = Math.floor(RES / tilesAcross);
          const tileCanvas = (typeof OffscreenCanvas !== "undefined")
            ? new OffscreenCanvas(tilePx, tilePx)
            : (() => { const el = document.createElement("canvas"); el.width = tilePx; el.height = tilePx; return el; })();
          const tctx = tileCanvas.getContext("2d");
          tctx.drawImage(img, 0, 0, tilePx, tilePx);
          const pat = ctx.createPattern(tileCanvas, "repeat");
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, RES, RES);
          const hmap = _canvasToHmap(ctx, opts.heightMM, { invert: !!opts.invert });
          resolve({ hmap, RES, tileWidth: opts.tileSizeMM * tilesAcross, fitMode: "tile" });
        } else {
          // Stretch — single image fills the canvas. The wrap engine
          // will then size tileWidth to the target's surface span so
          // the image appears exactly ONCE on the model.
          ctx.drawImage(img, 0, 0, RES, RES);
          const hmap = _canvasToHmap(ctx, opts.heightMM, { invert: !!opts.invert });
          // tileWidth is a placeholder — wrap engine overrides it for
          // stretch mode. We set it to 1 so misuse is obviously wrong.
          resolve({ hmap, RES, tileWidth: 1, fitMode: "stretch" });
        }
      } catch (e) { reject(e); }
    };
    img.onerror = (e) => reject(new Error("Failed to load image for heightmap: " + (e && e.message || "unknown")));
    img.src = imageSrc;
  });
}

/**
 * Render a small preview thumbnail of a built-in pattern as a data URL.
 * Used by the texture-library UI to show pattern previews without
 * shipping pre-rendered PNGs.
 */
export function patternPreviewDataUrl(pattern) {
  const drawer = _PATTERN_DRAWERS[pattern];
  if (!drawer) return null;
  // toDataURL is only on HTMLCanvasElement, not OffscreenCanvas — so we
  // force a regular DOM canvas for the preview path (the heightmap path
  // can use whichever is available).
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = RES; c.height = RES;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, RES, RES);
  drawer(ctx, RES / 4);
  return c.toDataURL("image/png");
}

export const HEIGHTMAP_RES = RES;

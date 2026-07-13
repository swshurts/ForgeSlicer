// Iter-87 — pure heightmap-mesh utilities, extracted from
// `components/dialogs/PhotoToPlaneDialog.jsx` so the canvas-pixel
// → vertex-grid → triangulated mesh pipeline can be unit-tested
// independently of React + DOM.
//
// Three exports:
//   - imageToLuminance(img, resTarget, opts)
//       Samples an HTMLImageElement into a `resW × resH` luminance grid
//       in [0,1]. Aspect ratio preserved on the wider axis. Off-screen
//       canvas used; safe to call from any browser thread.
//   - buildHeightmapMesh(lum, resW, resH, widthMM, baseHeight, reliefH)
//       Builds a watertight mesh: top surface displaced by luminance,
//       flat bottom, perimeter walls. Returns a Float32Array of
//       triangle vertices (shape compatible with `addImportedMesh`).
//   - estimateTriangleCount(res)
//       Cheap closed-form for the UI footer: triangles ≈ 4(res-1)² + 8(res-1).

// Read a File into an HTMLImageElement so Canvas can paint it. Promise-
// based — we only resolve once the image's load fires.
export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e || new Error("Image load failed")); };
    img.src = url;
  });
}

// Sample image into a `resW × resH` luminance grid in [0,1] plus an
// optional per-pixel alpha mask. Aspect ratio is preserved on the wider
// axis — the shorter axis gets fewer rows/cols proportionally.
//
// `gain` widens or compresses the contrast curve around the midpoint.
// `invert` flips the curve — used for lithophanes (dark = tall so
// backlight shows through where pixels were dark).
//
// Iter-140 — alpha-aware:
//   * When the source PNG carries a genuine alpha channel we return
//     an `alpha` Float32Array alongside `lum`. `buildHeightmapMesh`
//     consumes that so the mesh SILHOUETTE follows the transparent
//     boundary instead of always emitting a rectangular plate.
//   * Fully-transparent pixels (α = 0) were previously read as
//     RGBA(0,0,0,0) → luminance 0 → after invert=1 the mesh grew a
//     full-relief spike over every transparent pixel (the bug in the
//     screenshots). We now composite the RGB over neutral grey (128)
//     before the luminance calc so semi-transparent fringes contribute
//     no height signal and the alpha mask cleanly carves out the
//     boundary.
//
// Iter-141 — one-click background remover (`opts.bgRemove`):
//   { enabled, tolerance /* 0-100 */, sample /* {r,g,b} | null */,
//     result /* out param — set to the auto-sampled RGB */ }
//   When enabled, samples the four corner patches of the source (or
//   uses the caller-provided colour) and marks any pixel within
//   `tolerance` of that colour as transparent. Merged into `alpha`
//   so `buildHeightmapMesh` carves it out of the mesh silhouette.
export function imageToLuminance(img, resTarget, opts = {}) {
  const { gain = 1, invert = false, bgRemove = null } = opts;
  const aspect = img.width / img.height;
  const resW = aspect >= 1 ? resTarget : Math.max(8, Math.round(resTarget * aspect));
  const resH = aspect >= 1 ? Math.max(8, Math.round(resTarget / aspect)) : resTarget;
  const canvas = document.createElement("canvas");
  canvas.width = resW; canvas.height = resH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't get 2D context");
  ctx.drawImage(img, 0, 0, resW, resH);
  const raw = ctx.getImageData(0, 0, resW, resH).data;

  // Detect alpha: scan pixels for any α < 250. Skipping this scan when
  // the source is fully opaque avoids allocating the alpha array for
  // JPGs and typical opaque PNGs.
  let hasAlpha = false;
  for (let i = 3; i < raw.length; i += 4) {
    if (raw[i] < 250) { hasAlpha = true; break; }
  }
  let alpha = null;
  if (hasAlpha) {
    alpha = new Float32Array(resW * resH);
    for (let i = 3, j = 0; i < raw.length; i += 4, j++) {
      alpha[j] = raw[i] / 255;
    }
  }

  // Iter-141 — background removal. Adds transparent pixels to `alpha`
  // for every pixel within `tolerance` colour distance of the sample.
  if (bgRemove && bgRemove.enabled) {
    let sr, sg, sb;
    if (bgRemove.sample) {
      ({ r: sr, g: sg, b: sb } = bgRemove.sample);
    } else {
      // Auto-sample: median RGB across four corner patches (~6% each
      // side, min 2 px). Median beats mean because it ignores stray
      // signature marks / dust in a corner.
      const patch = Math.max(2, Math.floor(Math.min(resW, resH) * 0.06));
      const corners = [
        [0, 0], [resW - patch, 0],
        [0, resH - patch], [resW - patch, resH - patch],
      ];
      const rs = [], gs = [], bs = [];
      for (const [cx, cy] of corners) {
        for (let dy = 0; dy < patch; dy++) {
          for (let dx = 0; dx < patch; dx++) {
            const p = ((cy + dy) * resW + (cx + dx)) * 4;
            rs.push(raw[p]); gs.push(raw[p + 1]); bs.push(raw[p + 2]);
          }
        }
      }
      const median = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
      sr = median(rs); sg = median(gs); sb = median(bs);
    }
    // Write the (possibly auto-sampled) colour back for the UI swatch.
    if (bgRemove.result) { bgRemove.result.r = sr; bgRemove.result.g = sg; bgRemove.result.b = sb; }
    // tolerance 0..100 → max colour-distance ~130 (about 30% of the
    // theoretical max sqrt(3)·255 ≈ 442) — enough to catch soft studio
    // gradients without eating the subject at typical values.
    const thresh = (bgRemove.tolerance / 100) * 130;
    const threshSq = thresh * thresh;
    if (!alpha) alpha = new Float32Array(resW * resH).fill(1);
    for (let j = 0; j < resW * resH; j++) {
      const p = j * 4;
      const dr = raw[p] - sr, dg = raw[p + 1] - sg, db = raw[p + 2] - sb;
      if (dr * dr + dg * dg + db * db <= threshSq) {
        alpha[j] = 0;
      }
    }
    hasAlpha = true;
  }

  if (hasAlpha) {
    // Re-composite the image over neutral grey so transparent pixels
    // no longer contribute (0,0,0) to the luminance calc.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "rgb(128,128,128)";
    ctx.fillRect(0, 0, resW, resH);
    ctx.globalCompositeOperation = "source-over";
  }

  const data = hasAlpha ? ctx.getImageData(0, 0, resW, resH).data : raw;
  const lum = new Float32Array(resW * resH);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    // ITU-R BT.709 luminance coefficients — accurate for sRGB photos.
    let l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    // Contrast curve around midpoint, then clamp.
    l = (l - 0.5) * gain + 0.5;
    if (l < 0) l = 0; else if (l > 1) l = 1;
    if (invert) l = 1 - l;
    lum[j] = l;
  }
  return { lum, alpha, resW, resH };
}

// Build a watertight heightmap mesh:
//   - Top surface: grid of triangles deformed by `lum * reliefH + baseHeight`.
//   - Bottom surface: flat grid at y = 0.
//   - Perimeter walls sealing every solid-vs-transparent boundary so
//     the mesh is closed regardless of how carved-out the silhouette is.
// Output: Float32Array of contiguous triangle vertices [x,y,z,x,y,z,...].
//
// The returned mesh is hand-wound (no index buffer) — keeps shape
// consistent with `addImportedMesh` which expects flat verts.
//
// Iter-140 — alpha-aware: pass the `alpha` array returned by
// `imageToLuminance` to carve the mesh silhouette out. Quads whose
// 4 corners aren't all opaque (α ≥ 0.5) are skipped from both surfaces
// and walls are emitted at the boundary between kept vs skipped quads.
// Omitting `alpha` reproduces the pre-iter-140 rectangular plate.
export function buildHeightmapMesh(lum, resW, resH, widthMM, baseHeight, reliefH, alpha = null) {
  if (resW < 2 || resH < 2) throw new Error("Resolution too small (need ≥ 2 in each axis)");
  if (lum.length !== resW * resH) throw new Error("Luminance length doesn't match grid size");
  if (alpha && alpha.length !== resW * resH) throw new Error("Alpha length doesn't match grid size");
  const aspect = resW / resH;
  const sizeX = aspect >= 1 ? widthMM : widthMM * aspect;
  const sizeZ = aspect >= 1 ? widthMM / aspect : widthMM;
  const dx = sizeX / (resW - 1);
  const dz = sizeZ / (resH - 1);

  // Alpha membership per vertex (opaque if α ≥ 0.5). A missing alpha
  // channel means every vertex is opaque → keep_quad = true everywhere,
  // reproducing the legacy rectangular plate.
  const isOpaqueVert = alpha
    ? (xi, zi) => alpha[zi * resW + xi] >= 0.5
    : () => true;
  // A quad is emitted only when all 4 corners are opaque; otherwise
  // it's carved out. This gives a jagged pixel-edge silhouette which
  // is fine at ≥ 100 grid — the pixel step is < 1 mm.
  const keepQuad = (xi, zi) =>
    isOpaqueVert(xi, zi) &&
    isOpaqueVert(xi + 1, zi) &&
    isOpaqueVert(xi + 1, zi + 1) &&
    isOpaqueVert(xi, zi + 1);

  // Pre-compute top-grid positions (centered on origin in X/Z).
  const topVerts = new Float32Array(resW * resH * 3);
  for (let zi = 0; zi < resH; zi++) {
    for (let xi = 0; xi < resW; xi++) {
      const idx = (zi * resW + xi) * 3;
      const x = xi * dx - sizeX / 2;
      const z = zi * dz - sizeZ / 2;
      const y = baseHeight + lum[zi * resW + xi] * reliefH;
      topVerts[idx]     = x;
      topVerts[idx + 1] = y;
      topVerts[idx + 2] = z;
    }
  }

  // Dynamic sizing — with an alpha mask we don't know the quad count
  // up front, so `out` uses a JS array and we convert to Float32Array
  // at the end. When there's no alpha mask the sizing is cheap and the
  // conversion cost is negligible.
  const out = [];
  const writeTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };
  const top = (xi, zi) => {
    const i = (zi * resW + xi) * 3;
    return [topVerts[i], topVerts[i + 1], topVerts[i + 2]];
  };
  const bot = (xi, zi) => [xi * dx - sizeX / 2, 0, zi * dz - sizeZ / 2];

  // Top + bottom surfaces (both restricted to the kept-quad mask).
  for (let zi = 0; zi < resH - 1; zi++) {
    for (let xi = 0; xi < resW - 1; xi++) {
      if (!keepQuad(xi, zi)) continue;
      const [a0, a1, a2] = top(xi,     zi);
      const [b0, b1, b2] = top(xi + 1, zi);
      const [c0, c1, c2] = top(xi + 1, zi + 1);
      const [d0, d1, d2] = top(xi,     zi + 1);
      // Top — CCW from +Y.
      writeTri(a0, a1, a2, d0, d1, d2, b0, b1, b2);
      writeTri(b0, b1, b2, d0, d1, d2, c0, c1, c2);
      // Bottom — opposite winding.
      const [ba0, ba1, ba2] = bot(xi,     zi);
      const [bb0, bb1, bb2] = bot(xi + 1, zi);
      const [bc0, bc1, bc2] = bot(xi + 1, zi + 1);
      const [bd0, bd1, bd2] = bot(xi,     zi + 1);
      writeTri(ba0, ba1, ba2, bb0, bb1, bb2, bd0, bd1, bd2);
      writeTri(bb0, bb1, bb2, bc0, bc1, bc2, bd0, bd1, bd2);
    }
  }

  // Iter-140 — Emit a wall wherever a kept quad borders a skipped
  // quad (or the mesh's outer perimeter). This closes the silhouette
  // regardless of shape. For each of the 4 edges of every kept quad
  // we look at the neighbouring quad (across that edge) and emit a
  // wall when that neighbour is NOT kept.
  const isKept = (xi, zi) => xi >= 0 && xi < resW - 1 && zi >= 0 && zi < resH - 1 && keepQuad(xi, zi);

  const emitWall = (xi0, zi0, xi1, zi1) => {
    // xi0/zi0 and xi1/zi1 are adjacent grid VERTICES defining a wall
    // segment. The winding is chosen so that the wall's outward
    // normal points OUT of the mesh (i.e. from the kept quad toward
    // the empty side).
    const [t0x, t0y, t0z] = top(xi0, zi0);
    const [t1x, t1y, t1z] = top(xi1, zi1);
    const [b0x, b0y, b0z] = bot(xi0, zi0);
    const [b1x, b1y, b1z] = bot(xi1, zi1);
    writeTri(t0x, t0y, t0z, t1x, t1y, t1z, b1x, b1y, b1z);
    writeTri(t0x, t0y, t0z, b1x, b1y, b1z, b0x, b0y, b0z);
  };

  for (let zi = 0; zi < resH - 1; zi++) {
    for (let xi = 0; xi < resW - 1; xi++) {
      if (!keepQuad(xi, zi)) continue;
      // Top edge — quad above (zi-1) is NOT kept → wall between
      // (xi, zi) and (xi+1, zi). Winding puts outward normal toward -Z.
      if (!isKept(xi, zi - 1)) emitWall(xi + 1, zi, xi, zi);
      // Bottom edge — quad below (zi+1) not kept → wall to +Z.
      if (!isKept(xi, zi + 1)) emitWall(xi, zi + 1, xi + 1, zi + 1);
      // Left edge — quad to the left (xi-1) not kept → wall to -X.
      if (!isKept(xi - 1, zi)) emitWall(xi, zi, xi, zi + 1);
      // Right edge — quad to the right (xi+1) not kept → wall to +X.
      if (!isKept(xi + 1, zi)) emitWall(xi + 1, zi + 1, xi + 1, zi);
    }
  }

  return { vertices: new Float32Array(out), sizeX, sizeZ, height: baseHeight + reliefH };
}

// Quick UI estimate for the "triangles ≈ N" footer label. Closed-form;
// no allocation. For a square resolution `r`, the closed form is:
//   - top + bottom surfaces: 2 × 2 × (r-1)² = 4(r-1)²
//   - 4 perimeter strips:    8 × (r-1)
export function estimateTriangleCount(res) {
  if (res < 2) return 0;
  return 4 * (res - 1) * (res - 1) + 8 * (res - 1);
}

// Render a string of text onto a canvas so the same heightmap pipeline
// can be used to produce name plates / keychains / signs. Returns the
// HTMLCanvasElement directly — `imageToLuminance` accepts any image
// source `ctx.drawImage` does, so a canvas is a drop-in replacement
// for the loaded photo's HTMLImageElement.
//
// Defaults render BLACK text on a WHITE background — combined with the
// dialog's invert toggle (on by default) the text becomes the TALL part
// of the relief, which is what users want for keychains: legible
// letters standing proud of a flat base.
//
// Sizing: the canvas auto-fits the text bounding box plus a margin so
// the heightmap pipeline doesn't waste resolution on whitespace.
export function textToCanvas(text, opts = {}) {
  const {
    fontFamily = "system-ui, sans-serif",
    fontWeight = 700,
    fontSize = 240,           // High res so downsample to 100×100 stays crisp.
    color = "#000",
    background = "#fff",
    paddingPct = 0.12,        // 12% breathing room around the glyphs.
  } = opts;
  const safeText = (text || "").trim() || "Hello";

  // First pass — measure the text on a throwaway canvas.
  const measureCanvas = document.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");
  if (!mctx) throw new Error("Couldn't get 2D context for text measurement");
  mctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  const metrics = mctx.measureText(safeText);
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2;
  const textW = Math.max(1, metrics.width);
  const textH = ascent + descent;
  const padX = textW * paddingPct;
  const padY = textH * paddingPct;

  // Second pass — real canvas sized to the measured glyphs + padding.
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(textW + padX * 2);
  canvas.height = Math.ceil(textH + padY * 2);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't get 2D context for text render");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textBaseline = "alphabetic";
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  ctx.fillText(safeText, padX, padY + ascent);
  return canvas;
}

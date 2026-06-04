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

// Sample image into a `resW × resH` luminance grid in [0,1]. Aspect
// ratio preserved on the wider axis — the shorter axis gets fewer
// rows/cols proportionally.
//
// `gain` widens or compresses the contrast curve around the midpoint.
// `invert` flips the curve — used for lithophanes (dark = tall so
// backlight shows through where pixels were dark).
export function imageToLuminance(img, resTarget, opts = {}) {
  const { gain = 1, invert = false } = opts;
  const aspect = img.width / img.height;
  const resW = aspect >= 1 ? resTarget : Math.max(8, Math.round(resTarget * aspect));
  const resH = aspect >= 1 ? Math.max(8, Math.round(resTarget / aspect)) : resTarget;
  const canvas = document.createElement("canvas");
  canvas.width = resW; canvas.height = resH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't get 2D context");
  ctx.drawImage(img, 0, 0, resW, resH);
  const { data } = ctx.getImageData(0, 0, resW, resH);
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
  return { lum, resW, resH };
}

// Build a watertight heightmap mesh:
//   - Top surface: grid of triangles deformed by `lum * reliefH + baseHeight`.
//   - Bottom surface: flat grid at y = 0.
//   - Four perimeter walls so the mesh is closed.
// Output: Float32Array of contiguous triangle vertices [x,y,z,x,y,z,...].
//
// The returned mesh is hand-wound (no index buffer) — keeps shape
// consistent with `addImportedMesh` which expects flat verts.
export function buildHeightmapMesh(lum, resW, resH, widthMM, baseHeight, reliefH) {
  if (resW < 2 || resH < 2) throw new Error("Resolution too small (need ≥ 2 in each axis)");
  if (lum.length !== resW * resH) throw new Error("Luminance length doesn't match grid size");
  const aspect = resW / resH;
  const sizeX = aspect >= 1 ? widthMM : widthMM * aspect;
  const sizeZ = aspect >= 1 ? widthMM / aspect : widthMM;
  const dx = sizeX / (resW - 1);
  const dz = sizeZ / (resH - 1);

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

  // Allocate output array. Two surfaces × (resW-1)(resH-1) quads × 2
  // tris/quad. Plus 4 perimeter strips of length (resW-1) or (resH-1)
  // each — also 2 tris/quad. Closed-form so we avoid array push.
  const triCount = 2 * (resW - 1) * (resH - 1) * 2
                 + 2 * (resW - 1) * 2
                 + 2 * (resH - 1) * 2;
  const out = new Float32Array(triCount * 9);
  let p = 0;

  const writeTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    out[p++] = ax; out[p++] = ay; out[p++] = az;
    out[p++] = bx; out[p++] = by; out[p++] = bz;
    out[p++] = cx; out[p++] = cy; out[p++] = cz;
  };
  const top = (xi, zi) => {
    const i = (zi * resW + xi) * 3;
    return [topVerts[i], topVerts[i + 1], topVerts[i + 2]];
  };
  const bot = (xi, zi) => [xi * dx - sizeX / 2, 0, zi * dz - sizeZ / 2];

  // Top surface — winding CCW when viewed from above (+Y up).
  for (let zi = 0; zi < resH - 1; zi++) {
    for (let xi = 0; xi < resW - 1; xi++) {
      const [a0, a1, a2] = top(xi,     zi);
      const [b0, b1, b2] = top(xi + 1, zi);
      const [c0, c1, c2] = top(xi + 1, zi + 1);
      const [d0, d1, d2] = top(xi,     zi + 1);
      writeTri(a0, a1, a2, d0, d1, d2, b0, b1, b2);
      writeTri(b0, b1, b2, d0, d1, d2, c0, c1, c2);
    }
  }
  // Bottom surface — opposite winding.
  for (let zi = 0; zi < resH - 1; zi++) {
    for (let xi = 0; xi < resW - 1; xi++) {
      const [a0, a1, a2] = bot(xi,     zi);
      const [b0, b1, b2] = bot(xi + 1, zi);
      const [c0, c1, c2] = bot(xi + 1, zi + 1);
      const [d0, d1, d2] = bot(xi,     zi + 1);
      writeTri(a0, a1, a2, b0, b1, b2, d0, d1, d2);
      writeTri(b0, b1, b2, c0, c1, c2, d0, d1, d2);
    }
  }
  // Perimeter walls connect each top edge vertex to its corresponding
  // bottom edge vertex.
  // Front edge (zi=0)
  for (let xi = 0; xi < resW - 1; xi++) {
    const [a0, a1, a2] = top(xi,     0);
    const [b0, b1, b2] = top(xi + 1, 0);
    const [c0, c1, c2] = bot(xi + 1, 0);
    const [d0, d1, d2] = bot(xi,     0);
    writeTri(a0, a1, a2, b0, b1, b2, c0, c1, c2);
    writeTri(a0, a1, a2, c0, c1, c2, d0, d1, d2);
  }
  // Back edge (zi=resH-1) — reversed winding.
  for (let xi = 0; xi < resW - 1; xi++) {
    const [a0, a1, a2] = top(xi,     resH - 1);
    const [b0, b1, b2] = top(xi + 1, resH - 1);
    const [c0, c1, c2] = bot(xi + 1, resH - 1);
    const [d0, d1, d2] = bot(xi,     resH - 1);
    writeTri(b0, b1, b2, a0, a1, a2, d0, d1, d2);
    writeTri(b0, b1, b2, d0, d1, d2, c0, c1, c2);
  }
  // Left edge (xi=0)
  for (let zi = 0; zi < resH - 1; zi++) {
    const [a0, a1, a2] = top(0, zi);
    const [b0, b1, b2] = top(0, zi + 1);
    const [c0, c1, c2] = bot(0, zi + 1);
    const [d0, d1, d2] = bot(0, zi);
    writeTri(b0, b1, b2, a0, a1, a2, d0, d1, d2);
    writeTri(b0, b1, b2, d0, d1, d2, c0, c1, c2);
  }
  // Right edge (xi=resW-1)
  for (let zi = 0; zi < resH - 1; zi++) {
    const [a0, a1, a2] = top(resW - 1, zi);
    const [b0, b1, b2] = top(resW - 1, zi + 1);
    const [c0, c1, c2] = bot(resW - 1, zi + 1);
    const [d0, d1, d2] = bot(resW - 1, zi);
    writeTri(a0, a1, a2, b0, b1, b2, c0, c1, c2);
    writeTri(a0, a1, a2, c0, c1, c2, d0, d1, d2);
  }

  return { vertices: out, sizeX, sizeZ, height: baseHeight + reliefH };
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

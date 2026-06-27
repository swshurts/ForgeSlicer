// Text primitive — extruded glyphs as a first-class CAD primitive.
//
// Why this lives at the primitive level (not as a composite):
//   Text needs the same lifecycle as cube/cylinder/texture: it must
//   participate in CSG (positive = emboss, negative = engrave), it
//   must serialise/deserialise with the project, and the user must
//   be able to edit the string after creation. Bolting it on as a
//   composite would either make every edit re-build a group, or
//   force string edits through a custom dialog.
//
// How the geometry is produced:
//   `three/examples/jsm/geometries/TextGeometry.js` extrudes the
//   glyph outlines from a `typeface.json` font (Three.js's pre-parsed
//   font format — converted with facetype.js). We load the font once
//   per family, memoise the parsed `Font` instance, and rebuild the
//   geometry whenever `text` / `size` / `depth` / `bevel*` changes.
//
//   The resulting geometry is centred on the X/Y origin (so gizmo
//   rotate is intuitive) and sits with its base at Z=0 (so dropping
//   it on a host face means "the text's bottom face touches the
//   host's top face" — exactly how a beginner thinks about it).
//
// Why we ship typeface.json files in /public/fonts instead of
// importing them through the bundler:
//   - The user can drop their own typeface.json into /fonts/ at
//     deploy time without rebuilding (e.g. a brand font).
//   - Bundling these ~60-110 KB JSON blobs would bloat the main JS
//     chunk; fetch-on-demand keeps the landing page cheap.
//   - One async cache hit is fine — the user is editing text, not
//     scrolling a feed.

import * as THREE from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";

// Defaults — chosen to feel friendly for first-time CAD users:
//   • "Hello" is the most-recognised placeholder string.
//   • 8 mm size = roughly 22 pt at typical desktop print scale; big
//     enough to read on a keychain, small enough not to overflow the
//     default build plate.
//   • 2 mm depth is the FDM-safe minimum for engraved text (2 layers
//     at 0.2 mm + a 1.6 mm safety margin) and also looks proportional
//     when embossed.
//   • Bevel off by default — beginners get cleaner-looking results
//     without learning what bevel does, and the inspector exposes it
//     for users who want the polished look.
export const TEXT_DEFAULTS = {
    text: "Hello",
    font: "helvetiker_regular",       // matches /fonts/<font>.typeface.json
    size: 8,                           // mm — extruded glyph height
    depth: 2,                          // mm — extrusion along +Z
    curveSegments: 6,                  // smoothness of curved edges in glyphs
    bevelEnabled: false,
    bevelThickness: 0.15,              // mm — small rounded edges
    bevelSize: 0.15,                   // mm
    bevelSegments: 2,
    align: "center",                   // "left" | "center" | "right"
};

// Display labels for the inspector dropdown.
export const TEXT_FONTS = [
    { value: "helvetiker_regular", label: "Helvetiker · Regular" },
    { value: "helvetiker_bold", label: "Helvetiker · Bold" },
    { value: "optimer_regular", label: "Optimer · Serif" },
];

// Cache: family-id → Promise<Font>. Promises (not resolved Fonts) so
// concurrent callers in the same tick share the same fetch.
const _fontCache = new Map();
// Cache: family-id → resolved Font (sync-accessible once loaded).
// `buildTextGeometry` is called synchronously from `buildGeometry`,
// so it CANNOT await. If the font isn't loaded yet, we return a
// placeholder geometry AND kick off the load — the next render
// (triggered by the cache update) will use the real font.
const _fontReady = new Map();
// Subscribers to call when a new font finishes loading. Lets the
// viewport know it should re-render the affected meshes.
const _fontListeners = new Set();

/** Subscribe to font-loaded events. Returns an unsubscribe fn. */
export function onFontLoaded(fn) {
    _fontListeners.add(fn);
    return () => _fontListeners.delete(fn);
}

/** Returns the resolved Font for `family` if loaded; otherwise null
 *  and triggers an async load in the background.
 *
 *  iter-108.x — Resilience pass after Steve hit a case where Helvetiker
 *  Bold and Optimer downloaded successfully (200 OK, valid JSON) but
 *  the placeholder slab never swapped to real glyphs. Two robustness
 *  changes:
 *   1. On FontLoader error, REMOVE the family from `_fontCache` so a
 *      future call retries instead of being stuck on the rejected
 *      Promise.
 *   2. Always notify listeners on success AND failure so the Viewport
 *      can rebuild the geometry (real font if loaded, default-font
 *      fallback if failed — never the placeholder slab).
 *   3. Console.info/warn breadcrumbs so a tester can spot which family
 *      is mis-behaving from the browser console without us shipping
 *      a debug build.
 */
export function getFontSync(family) {
    if (_fontReady.has(family)) return _fontReady.get(family);
    if (!_fontCache.has(family)) {
        const loader = new FontLoader();
        const url = `/fonts/${family}.typeface.json`;
        const t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const p = new Promise((resolve, reject) => {
            loader.load(
                url,
                (font) => {
                    _fontReady.set(family, font);
                    const dt = ((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0) | 0;
                    console.info(`[textGeometry] font '${family}' loaded in ${dt}ms; notifying ${_fontListeners.size} listener(s)`);
                    _fontListeners.forEach((fn) => {
                        try { fn(family); } catch (_) { /* noop */ }
                    });
                    resolve(font);
                },
                undefined,
                (err) => {
                    // Wipe the cache entry so the next call can retry.
                    _fontCache.delete(family);
                    console.warn(`[textGeometry] font '${family}' FAILED to load`, err);
                    // Still notify listeners — Viewport will re-render and
                    // buildTextGeometry's default-font fallback will kick in
                    // so the user sees real text instead of a frozen slab.
                    _fontListeners.forEach((fn) => {
                        try { fn(family); } catch (_) { /* noop */ }
                    });
                    reject(err);
                },
            );
        });
        // Swallow unhandled rejections so the browser doesn't spam them
        // (we already log a warn above; downstream code does not await).
        p.catch(() => {});
        _fontCache.set(family, p);
    }
    return null;
}

/** Eager preload — used by the toolbar so the first "Add Text"
 *  click already has the default font in cache. */
export function preloadDefaultFont() {
    getFontSync(TEXT_DEFAULTS.font);
}

/**
 * Build a BufferGeometry for a text primitive.
 *
 * Returns a tiny placeholder cube while the font is loading so the
 * scene graph stays valid; the Viewport subscribes to onFontLoaded
 * and re-renders once the real font is available.
 */
export function buildTextGeometry(obj) {
    const d = { ...TEXT_DEFAULTS, ...(obj?.dims || {}) };
    const text = String(d.text ?? "").length ? String(d.text) : " ";

    const requested = d.font || TEXT_DEFAULTS.font;
    let font = getFontSync(requested);
    // iter-108.x — If the requested font isn't loaded yet, fall back to
    // the default font (which Workspace.jsx preloads at boot, so it's
    // virtually always ready). The user sees real glyphs immediately
    // instead of a confusing slab, and the Viewport's onFontLoaded
    // listener swaps in the requested font the moment it arrives. The
    // legacy BoxGeometry placeholder is reserved for the genuinely
    // unlucky first-paint where even the default font hasn't loaded.
    if (!font && requested !== TEXT_DEFAULTS.font) {
        font = getFontSync(TEXT_DEFAULTS.font);
    }
    if (!font) {
        // Last-resort placeholder — small slab so booleans don't go off
        // the rails before any font arrives. Subsequent renders will
        // pick up the real font via the onFontLoaded mechanism.
        const ph = new THREE.BoxGeometry(d.size * Math.max(text.length, 1) * 0.6, d.size, d.depth);
        ph.translate(0, 0, d.depth / 2);
        return ph;
    }

    const geo = new TextGeometry(text, {
        font,
        size: Math.max(0.1, Number(d.size) || TEXT_DEFAULTS.size),
        depth: Math.max(0.1, Number(d.depth) || TEXT_DEFAULTS.depth),
        curveSegments: Math.max(1, Math.min(24, Number(d.curveSegments) || TEXT_DEFAULTS.curveSegments)),
        bevelEnabled: !!d.bevelEnabled,
        bevelThickness: Math.max(0, Number(d.bevelThickness) || 0),
        bevelSize: Math.max(0, Number(d.bevelSize) || 0),
        bevelSegments: Math.max(1, Math.min(8, Number(d.bevelSegments) || 1)),
    });

    // TextGeometry produces glyphs with origin at left baseline and
    // extruded along +Z (it lays flat on XY by default when the font
    // is oriented as TextGeometry expects). We:
    //  1. computeBoundingBox to find the natural extents,
    //  2. translate so the chosen alignment puts X at zero,
    //  3. translate Y so the text's baseline → bottom face sits at Y=0
    //     (it's normally a touch below baseline; lift the descender),
    //  4. leave Z untouched so the extrusion sits with its bottom face
    //     at Z=0 (matches every other primitive's "base on the plate").
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const w = bb.max.x - bb.min.x;
    const h = bb.max.y - bb.min.y;

    let dx = 0;
    if (d.align === "center") dx = -(bb.min.x + w / 2);
    else if (d.align === "right") dx = -bb.max.x;
    else dx = -bb.min.x;

    const dy = -(bb.min.y + h / 2);     // vertical-centre on Y
    const dz = -bb.min.z;               // base at Z=0

    geo.translate(dx, dy, dz);
    geo.computeBoundingBox();
    geo.computeVertexNormals();
    return geo;
}

// One-shot TTF/OTF → Three.js typeface.json converter.
//
// Reproduces the output shape that the official facetype.js webapp
// (https://gero3.github.io/facetype.js/) produces — same key order,
// same glyph encoding (`ha`, `o`, `x_max`, `x_min`) — so the resulting
// JSON drops straight into THREE.FontLoader without any patching.
//
// Usage:
//   node ttf2typeface.js <input.ttf> <output.typeface.json>
//
// Accepts a single ASCII range by default. Latin-1 supplement is added
// automatically so accented characters work for European-language users
// (we already see Spanish/French/German visitors).

const fs   = require("fs");
const path = require("path");
const opentype = require("opentype.js");

const REVERSE_TYPEFACE_KEY_MAP = { 0: "C", 1: "Q", 2: "M", 3: "L", 4: "T", 5: "B", 7: "Z" };

const RESTRICT_RANGES = [
    [0x0020, 0x007e], // Basic Latin (printable ASCII)
    [0x00a0, 0x00ff], // Latin-1 Supplement (accented chars)
];

function inRanges(cp) {
    for (const [lo, hi] of RESTRICT_RANGES) if (cp >= lo && cp <= hi) return true;
    return false;
}

// facetype.js builds the `o` field as a space-separated stream:
//   token = one of m / l / q / b (case is preserved as facetype emits)
// Followed by 2/4/6 coordinates (rounded to ints). We mirror that.
function pathToFacetypeO(path) {
    const out = [];
    for (const cmd of path.commands) {
        if (cmd.type === "M") {
            out.push("m", Math.round(cmd.x), Math.round(cmd.y));
        } else if (cmd.type === "L") {
            out.push("l", Math.round(cmd.x), Math.round(cmd.y));
        } else if (cmd.type === "Q") {
            out.push("q", Math.round(cmd.x), Math.round(cmd.y), Math.round(cmd.x1), Math.round(cmd.y1));
        } else if (cmd.type === "C") {
            out.push("b", Math.round(cmd.x), Math.round(cmd.y), Math.round(cmd.x1), Math.round(cmd.y1), Math.round(cmd.x2), Math.round(cmd.y2));
        } else if (cmd.type === "Z") {
            out.push("z");
        }
    }
    return out.join(" ");
}

function convert(inputPath, outputPath, opts = {}) {
    const buf  = fs.readFileSync(inputPath);
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

    const glyphs = {};
    const all = font.glyphs.glyphs;
    let glyphCount = 0;
    for (const key in all) {
        const g = all[key];
        if (g.unicode === undefined) continue;
        if (!inRanges(g.unicode)) continue;
        const ch = String.fromCharCode(g.unicode);
        const p  = g.getPath(0, 0, font.unitsPerEm);
        glyphs[ch] = {
            ha: Math.round(g.advanceWidth),
            x_min: Math.round(g.xMin || p.getBoundingBox().x1 || 0),
            x_max: Math.round(g.xMax || p.getBoundingBox().x2 || 0),
            o: pathToFacetypeO(p),
        };
        glyphCount += 1;
    }

    const familyName = (font.names.fontFamily?.en) || opts.familyOverride || "Unknown";
    const subFamily  = (font.names.fontSubfamily?.en) || "Regular";
    const out = {
        glyphs,
        familyName,
        ascender: Math.round(font.ascender),
        descender: Math.round(font.descender),
        underlinePosition: Math.round(font.tables.post?.underlinePosition ?? -100),
        underlineThickness: Math.round(font.tables.post?.underlineThickness ?? 50),
        boundingBox: {
            yMin: Math.round(font.tables.head.yMin),
            xMin: Math.round(font.tables.head.xMin),
            yMax: Math.round(font.tables.head.yMax),
            xMax: Math.round(font.tables.head.xMax),
        },
        resolution: font.unitsPerEm,
        original_font_information: {
            format: 0,
            copyright: (font.names.copyright?.en) || "",
            fontFamily: familyName,
            fontSubfamily: subFamily,
            uniqueID: (font.names.uniqueID?.en) || "",
            fullName: (font.names.fullName?.en) || `${familyName} ${subFamily}`,
            version: (font.names.version?.en) || "",
            postScriptName: (font.names.postScriptName?.en) || "",
            licenseURL: (font.names.licenseURL?.en) || "",
        },
        cssFontWeight: /bold/i.test(subFamily) ? "bold" : "normal",
        cssFontStyle: /italic/i.test(subFamily) ? "italic" : "normal",
    };
    fs.writeFileSync(outputPath, JSON.stringify(out));
    console.log(`OK ${path.basename(inputPath)} → ${path.basename(outputPath)}  (family=${familyName}, glyphs=${glyphCount}, size=${(fs.statSync(outputPath).size / 1024).toFixed(1)}KB)`);
}

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
    console.error("Usage: node ttf2typeface.js <input.ttf> <output.typeface.json>");
    process.exit(1);
}
convert(inPath, outPath);

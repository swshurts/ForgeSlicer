// Shared G-code parser + helpers.
//
// Used by GcodePreviewDialog (single-engine layer scrubber) and by the
// EngineComparisonDialog's toolpath overlay tab (built-in vs Orca on
// the same canvas, per-layer). Both call sites need the same per-layer
// move list, AMS tool table, bounding box, and z-mapping, so the parser
// lives here instead of being duplicated.
//
// Output shape:
// {
//   layers: [{
//     idx,            // 0-based ordinal
//     z,              // Z height in mm
//     moves: [{x0,y0,x1,y1,extruding,tool}, ...],
//     toolChangeMarkers: [{x,y,tool}, ...],
//     extrudeMoves, travelMoves, toolChanges,
//   }, ...],
//   tools: [{ index, hex, name }, ...]   // sorted by index, AMS-resolved hex
//   bbox: { x, y, minX, minY, maxX, maxY }  // extrude-only bbox in mm
// }

export function parseGcode(gcode) {
  const layers = [];
  const toolMap = new Map();
  let cur = null;
  let x = 0, y = 0, z = 0;
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  let activeTool = 0;

  const lines = (gcode || "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();

    // AMS color table — declared once in the header.
    const mAms = /^;\s*AMS_TABLE\s+(.+)$/.exec(line);
    if (mAms) {
      const re = /T(\d+)\s*=\s*(#[0-9a-fA-F]{6})/g;
      let m;
      while ((m = re.exec(mAms[1])) !== null) {
        const idx = parseInt(m[1], 10);
        const existing = toolMap.get(idx) || { index: idx };
        toolMap.set(idx, { ...existing, hex: m[2] });
      }
      continue;
    }

    // Tool marker `; TOOL:n hex=#... name=...`.
    const mTool = /^;\s*TOOL:\s*(\d+)\s*(?:hex=(#[0-9a-fA-F]{6}))?\s*(?:name=(.+))?$/.exec(line);
    if (mTool) {
      const idx = parseInt(mTool[1], 10);
      const hex = mTool[2];
      const name = (mTool[3] || "").trim();
      const existing = toolMap.get(idx) || { index: idx };
      toolMap.set(idx, {
        index: idx,
        hex: hex || existing.hex,
        name: name || existing.name,
      });
      if (cur && idx !== activeTool) {
        cur.toolChanges = (cur.toolChanges || 0) + 1;
        cur.toolChangeMarkers.push({ x, y, tool: idx });
      }
      activeTool = idx;
      continue;
    }

    if (!line || line.startsWith(";")) {
      // Layer header: `; LAYER:n z=mm`. Both engines emit this — Orca
      // because we configure the post-processor to, the built-in
      // slicer because it's hardcoded in `lib/slicer.js`.
      const mLayer = /^;\s*LAYER:\s*(\d+)\s*z\s*=\s*([0-9.+-eE]+)/.exec(line);
      if (mLayer) {
        cur = {
          idx: parseInt(mLayer[1], 10),
          z: parseFloat(mLayer[2]),
          moves: [],
          toolChangeMarkers: [],
          extrudeMoves: 0,
          travelMoves: 0,
          toolChanges: 0,
        };
        layers.push(cur);
      }
      continue;
    }

    // Explicit tool change `Tn` — same effect as a `; TOOL:` marker.
    const mT = /^T(\d+)\b/.exec(line);
    if (mT) {
      const idx = parseInt(mT[1], 10);
      if (cur && idx !== activeTool) {
        cur.toolChanges = (cur.toolChanges || 0) + 1;
        cur.toolChangeMarkers.push({ x, y, tool: idx });
      }
      if (!toolMap.has(idx)) toolMap.set(idx, { index: idx });
      activeTool = idx;
      continue;
    }

    // Only G0 / G1 are toolpath moves.
    if (!/^G[01]\b/.test(line)) continue;
    const isG0 = /^G0\b/.test(line);
    const nx = readArg(line, "X");
    const ny = readArg(line, "Y");
    const nz = readArg(line, "Z");
    const hasE = /\sE-?[0-9]/.test(line);
    if (nz != null) z = nz;
    const fromX = x, fromY = y;
    if (nx != null) x = nx;
    if (ny != null) y = ny;
    if (cur) {
      if (nx != null || ny != null) {
        const extruding = !isG0 && hasE;
        cur.moves.push({ x0: fromX, y0: fromY, x1: x, y1: y, extruding, tool: activeTool });
        if (extruding) cur.extrudeMoves++; else cur.travelMoves++;
        if (extruding) {
          if (x < xMin) xMin = x; if (x > xMax) xMax = x;
          if (y < yMin) yMin = y; if (y > yMax) yMax = y;
          if (fromX < xMin) xMin = fromX; if (fromX > xMax) xMax = fromX;
          if (fromY < yMin) yMin = fromY; if (fromY > yMax) yMax = fromY;
        }
      }
    }
  }
  if (!isFinite(xMin)) { xMin = 0; xMax = 0; yMin = 0; yMax = 0; }

  const tools = Array.from(toolMap.values())
    .sort((a, b) => a.index - b.index)
    .map((t) => ({ index: t.index, hex: t.hex || "#f97316", name: t.name || "" }));

  // Suppress unused: ensure z is read post-loop in case of empty input,
  // and so future consumers can grab the final Z from the parser if needed.
  void z;

  return {
    layers,
    tools,
    bbox: { x: xMax - xMin, y: yMax - yMin, minX: xMin, minY: yMin, maxX: xMax, maxY: yMax },
  };
}

function readArg(line, ch) {
  const re = new RegExp(`\\s${ch}(-?[0-9]*\\.?[0-9]+)`);
  const m = re.exec(" " + line);
  return m ? parseFloat(m[1]) : null;
}

// ----------------- Comparison helpers -----------------
//
// Given two parsed G-code dumps from different engines (built-in vs Orca),
// produce a per-layer-pair diff describing which segments are EXCLUSIVE to
// one side vs SHARED between both. Used by the EngineComparisonDialog's
// toolpath overlay tab to render "what does Orca add that the built-in
// slicer skips?".
//
// We pair layers by sorted Z order (not by index) because the two engines
// use different first-layer height conventions and slightly different
// effective layer heights — pairing by index would systematically misalign
// every comparison after layer 0. Within a paired layer, we treat a move
// as "shared" if a move on the other side has matching `(x0,y0,x1,y1)`
// endpoints within `tolMm`. Direction is ignored (a segment traversed
// `A→B` matches one traversed `B→A`) because the two engines tend to
// reverse perimeter direction on alternating layers.

export function pairLayersByZ(parsedA, parsedB) {
  // Both engines emit layers roughly in Z-ascending order. We zip in
  // order, BUT use the actual z values for the displayed label.
  const a = parsedA?.layers || [];
  const b = parsedB?.layers || [];
  const max = Math.max(a.length, b.length);
  const pairs = [];
  for (let i = 0; i < max; i++) {
    pairs.push({
      idx: i,
      zA: a[i]?.z ?? null,
      zB: b[i]?.z ?? null,
      layerA: a[i] || null,
      layerB: b[i] || null,
    });
  }
  return pairs;
}

// Quick endpoint hash so we can do an O(n+m) set-intersection per layer
// instead of an O(n*m) double loop. `tolMm` quantises each coordinate
// so near-matches collide on the same hash bucket.
function moveHash(m, tolMm) {
  // Make hash direction-insensitive by sorting endpoints lexicographically
  // before hashing.
  const a = [m.x0, m.y0];
  const b = [m.x1, m.y1];
  const [p0, p1] = (a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])) ? [a, b] : [b, a];
  const q = (v) => Math.round(v / tolMm);
  return `${q(p0[0])}_${q(p0[1])}|${q(p1[0])}_${q(p1[1])}`;
}

// For a layer pair, partition each side's EXTRUDE moves into
// `{ shared, unique }`. Travel moves are skipped (the overlay focuses
// on actual deposited filament). Returns:
// {
//   uniqueA: [moves...], uniqueB: [moves...],
//   sharedA: [moves...], sharedB: [moves...],   // distinct so callers can stroke once
//   stats: { totalA, totalB, sharedCount, uniqueACount, uniqueBCount }
// }
export function diffLayerPair(pair, tolMm = 0.4) {
  const movesA = (pair.layerA?.moves || []).filter((m) => m.extruding);
  const movesB = (pair.layerB?.moves || []).filter((m) => m.extruding);
  const hashB = new Map();   // hash → count of unmatched B moves
  for (const m of movesB) {
    const h = moveHash(m, tolMm);
    hashB.set(h, (hashB.get(h) || 0) + 1);
  }
  const uniqueA = [];
  const sharedA = [];
  for (const m of movesA) {
    const h = moveHash(m, tolMm);
    const c = hashB.get(h) || 0;
    if (c > 0) {
      hashB.set(h, c - 1);
      sharedA.push(m);
    } else {
      uniqueA.push(m);
    }
  }
  // Anything left in hashB is exclusive to B. We need to rebuild the
  // move list from the hash count map, so we walk B again and skip the
  // ones that got "consumed" by sharedA matches above. That requires
  // a second pass over the same hash map; we use a fresh remaining map.
  const hashBconsumed = new Map();
  for (const m of sharedA) {
    const h = moveHash(m, tolMm);
    hashBconsumed.set(h, (hashBconsumed.get(h) || 0) + 1);
  }
  const sharedB = [];
  const uniqueB = [];
  for (const m of movesB) {
    const h = moveHash(m, tolMm);
    const c = hashBconsumed.get(h) || 0;
    if (c > 0) {
      hashBconsumed.set(h, c - 1);
      sharedB.push(m);
    } else {
      uniqueB.push(m);
    }
  }
  return {
    uniqueA, uniqueB, sharedA, sharedB,
    stats: {
      totalA: movesA.length,
      totalB: movesB.length,
      sharedCount: sharedA.length,
      uniqueACount: uniqueA.length,
      uniqueBCount: uniqueB.length,
    },
  };
}

// Combined bounding box across BOTH parsed dumps. Used to size the
// shared canvas so segments from either side are guaranteed in-frame.
export function combinedBbox(parsedA, parsedB) {
  const bA = parsedA?.bbox;
  const bB = parsedB?.bbox;
  const valid = [];
  if (bA && (bA.x > 0 || bA.y > 0)) valid.push(bA);
  if (bB && (bB.x > 0 || bB.y > 0)) valid.push(bB);
  if (valid.length === 0) return { x: 0, y: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const minX = Math.min(...valid.map((b) => b.minX));
  const minY = Math.min(...valid.map((b) => b.minY));
  const maxX = Math.max(...valid.map((b) => b.maxX));
  const maxY = Math.max(...valid.map((b) => b.maxY));
  return { x: maxX - minX, y: maxY - minY, minX, minY, maxX, maxY };
}

// Hardware library — ISO metric thread standards table.
//
// Each entry describes a single physical fastener part: major radius
// (`majorR` = the OUTER thread radius, half of the conventional "M
// number"), pitch (mm between thread peaks), and head dimensions
// for the bolt half. We use SHORT shaft lengths by default; the user
// picks `length` separately from the library UI so the same M5 entry
// covers everything from M5×10 through M5×100.
//
// Pitch / head defaults match ISO 4014 (hex) / ISO 4762 (cap socket)
// where possible; the library is "common shop sizes" — not exhaustive.
// Adding more grades is just appending to TABLE.
//
// `addFastenerPair`'s opts map 1:1 to these fields, so dropping a
// hardware spec into the store is just `addFastenerPair(spec)`.

export const HARDWARE_TABLE = [
  // M-number, majorR, coarse pitch, head width (across flats), head height
  // headR = headWidthAcrossFlats / 2 (close enough for our representation;
  // the bolt primitive's headStyle:"hex" rounds to a hex with this radius).
  { id: "M3",  m: 3,  majorR: 1.5, pitch: 0.5,  headR: 2.75, headH: 2.0, nutH: 2.4 },
  { id: "M4",  m: 4,  majorR: 2.0, pitch: 0.7,  headR: 3.5,  headH: 2.8, nutH: 3.2 },
  { id: "M5",  m: 5,  majorR: 2.5, pitch: 0.8,  headR: 4.0,  headH: 3.5, nutH: 4.0 },
  { id: "M6",  m: 6,  majorR: 3.0, pitch: 1.0,  headR: 5.0,  headH: 4.0, nutH: 4.8 },
  { id: "M8",  m: 8,  majorR: 4.0, pitch: 1.25, headR: 6.5,  headH: 5.3, nutH: 6.5 },
  { id: "M10", m: 10, majorR: 5.0, pitch: 1.5,  headR: 8.0,  headH: 6.4, nutH: 8.0 },
  { id: "M12", m: 12, majorR: 6.0, pitch: 1.75, headR: 9.5,  headH: 7.5, nutH: 10.0 },
];

// Common shop lengths (mm). For grades up through M6 we list the
// shorter lengths; for M8+ we list longer ones. The picker shows the
// list filtered to ones that "make sense" for the chosen grade —
// avoids showing an M3×80 (silly) or an M12×6 (impossible).
export const HARDWARE_LENGTHS_BY_GRADE = {
  M3:  [5, 8, 10, 12, 16, 20, 25, 30],
  M4:  [6, 8, 10, 12, 16, 20, 25, 30, 40],
  M5:  [6, 8, 10, 12, 16, 20, 25, 30, 40, 50],
  M6:  [10, 12, 16, 20, 25, 30, 40, 50, 60],
  M8:  [12, 16, 20, 25, 30, 40, 50, 60, 80, 100],
  M10: [16, 20, 25, 30, 40, 50, 60, 80, 100, 120],
  M12: [20, 25, 30, 40, 50, 60, 80, 100, 120, 150],
};

/**
 * Map a hardware-table row + a chosen length to the `opts` shape
 * `addFastenerPair` accepts. `workThickness` defaults to length - 5mm
 * (so 5mm of shaft pokes past the nut, ready to grip), but the caller
 * can override.
 */
export function hardwareToFastenerOpts(spec, length, workThicknessOverride = null) {
  const workThickness = workThicknessOverride ?? Math.max(2, length - 5);
  return {
    boltR: spec.majorR,
    pitch: spec.pitch,
    workThickness,
    headR: spec.headR,
    headH: spec.headH,
    shaftH: length,
    nutH: spec.nutH,
    groupName: `Fastener ${spec.id}×${length}`,
  };
}

// ----- Imperial UNC / UNF coarse-thread inch fasteners (iter 50) -------
// Inch-system equivalents. We map "1/4" → "1/4-20" (coarse) by default.
// All dimensions stored in MILLIMETRES so the rest of the engine doesn't
// care about units. Conversion: 1 inch = 25.4mm. Pitch for an imperial
// thread = 25.4mm / TPI (threads per inch). Head dims sourced from
// ANSI/ASME B18.6.3 (slotted hex cap screws, common shop dims).
//
// Format mirrors HARDWARE_TABLE — same field names — so the dialog
// code can pick which table to render and `hardwareToFastenerOpts`
// works against either without modification.
export const HARDWARE_TABLE_IMPERIAL = [
  // M-equivalent label, major diameter in inches (×25.4=mm), TPI, head dims
  { id: "#4-40",  m: "4-40",   majorR: (0.112 * 25.4) / 2, pitch: 25.4 / 40, headR: 2.65, headH: 1.9, nutH: 2.5 },
  { id: "#6-32",  m: "6-32",   majorR: (0.138 * 25.4) / 2, pitch: 25.4 / 32, headR: 3.20, headH: 2.4, nutH: 2.7 },
  { id: "#8-32",  m: "8-32",   majorR: (0.164 * 25.4) / 2, pitch: 25.4 / 32, headR: 3.80, headH: 2.8, nutH: 3.2 },
  { id: "#10-24", m: "10-24",  majorR: (0.190 * 25.4) / 2, pitch: 25.4 / 24, headR: 4.40, headH: 3.3, nutH: 3.6 },
  { id: "1/4-20", m: "1/4-20", majorR: (0.250 * 25.4) / 2, pitch: 25.4 / 20, headR: 5.55, headH: 4.4, nutH: 5.6 },
  { id: "5/16-18",m: "5/16-18",majorR: (0.3125 * 25.4) / 2,pitch: 25.4 / 18, headR: 6.95, headH: 5.4, nutH: 6.5 },
  { id: "3/8-16", m: "3/8-16", majorR: (0.375 * 25.4) / 2, pitch: 25.4 / 16, headR: 8.35, headH: 6.4, nutH: 7.5 },
  { id: "1/2-13", m: "1/2-13", majorR: (0.500 * 25.4) / 2, pitch: 25.4 / 13, headR: 11.15, headH: 8.3, nutH: 10.0 },
];

// Common imperial lengths in INCHES (we stringify into the picker but
// store/use the millimetric equivalent). 1/4 = 6.35mm etc.
const INCHES = [
  ["1/4",    6.35],
  ["3/8",    9.525],
  ["1/2",    12.7],
  ["5/8",    15.875],
  ["3/4",    19.05],
  ["1",      25.4],
  ["1-1/4",  31.75],
  ["1-1/2",  38.1],
  ["2",      50.8],
  ["2-1/2",  63.5],
  ["3",      76.2],
  ["4",      101.6],
];

// Filter by what's commonly available per grade. Short fasteners
// don't exist in big diameters (M12 × 6mm makes no sense); long
// ones don't fit small diameters (#4-40 × 4" snaps off).
export const HARDWARE_LENGTHS_BY_GRADE_IMPERIAL = {
  "#4-40":   INCHES.filter(([, mm]) => mm <= 25.4),
  "#6-32":   INCHES.filter(([, mm]) => mm <= 38.1),
  "#8-32":   INCHES.filter(([, mm]) => mm <= 50.8),
  "#10-24":  INCHES.filter(([, mm]) => mm <= 63.5),
  "1/4-20":  INCHES.filter(([, mm]) => mm <= 76.2),
  "5/16-18": INCHES.filter(([, mm]) => mm <= 101.6),
  "3/8-16":  INCHES,
  "1/2-13":  INCHES.filter(([, mm]) => mm >= 12.7),
};

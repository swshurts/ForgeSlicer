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

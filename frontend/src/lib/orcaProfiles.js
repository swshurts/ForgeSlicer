// OrcaSlicer profile presets — printer / process / filament templates that
// get POSTed to the backend's /api/slice/orca/slice endpoint as the
// `printer_profile`, `process_profile`, `filament_profile` fields.
//
// Why so few fields per preset?
//   OrcaSlicer's actual profile JSON has hundreds of keys — we ship only
//   the ones that meaningfully change first-print outcomes. The OrcaSlicer
//   CLI fills the rest from its bundled "Generic FFF" baseline, so a
//   minimal JSON that overrides just printable_area / nozzle_diameter /
//   layer_height / wall_loops / sparse_infill_* is enough to get a clean
//   slice for any of these machines.
//
// Sources for the printer specs:
//   • Bambu — bambulab.com product pages + OrcaSlicer's own bundled
//     profiles (which Bambu Lab maintain)
//   • Prusa — prusa3d.com MK4 spec sheet
//   • Voron — vorondesign.com/voron2.4 reference docs
//   • Sovol — sovol3d.com product pages (SV06/SV06+/SV07/SV08)
//   • Creality Ender 3 — kept as a sanity-check fallback because it's
//     still the most-owned printer in our likely user base
//
// Naming/keys mirror OrcaSlicer's bundled profile JSON schema so a future
// "Import OrcaSlicer profile" feature can drop a user-supplied JSON
// straight in without any field renaming.

export const PRINTER_PROFILES = {
  bambu_a1: {
    id: "bambu_a1", label: "Bambu Lab A1", category: "Bambu Lab",
    profile: {
      printer_model: "Bambu Lab A1",
      printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "256x0", "256x256", "0x256"],
      printable_height: 256,
      gcode_flavor: "marlin2",
      machine_max_acceleration_extruding: [10000],
      machine_max_speed_x: [500], machine_max_speed_y: [500],
      machine_max_speed_z: [12], machine_max_speed_e: [30],
      retraction_length: [0.8], retraction_speed: [30],
      // Bambu firmware's start-gcode templates rely on G28 + extrude
      // priming. The CLI ships a generic version that works for A1 +
      // P-series so we leave this blank and let OrcaSlicer fill it.
    },
  },
  bambu_a1_mini: {
    id: "bambu_a1_mini", label: "Bambu Lab A1 mini", category: "Bambu Lab",
    profile: {
      printer_model: "Bambu Lab A1 mini",
      printer_variant: "0.4", nozzle_diameter: [0.4],
      printable_area: ["0x0", "180x0", "180x180", "0x180"],
      printable_height: 180,
      gcode_flavor: "marlin2",
      machine_max_speed_x: [500], machine_max_speed_y: [500],
      retraction_length: [0.8], retraction_speed: [30],
    },
  },
  bambu_p1s: {
    id: "bambu_p1s", label: "Bambu Lab P1S", category: "Bambu Lab",
    profile: {
      printer_model: "Bambu Lab P1S", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "256x0", "256x256", "0x256"],
      printable_height: 256, gcode_flavor: "marlin2",
      machine_max_speed_x: [500], machine_max_speed_y: [500],
      retraction_length: [0.8], retraction_speed: [30],
    },
  },
  bambu_x1c: {
    id: "bambu_x1c", label: "Bambu Lab X1 Carbon", category: "Bambu Lab",
    profile: {
      printer_model: "Bambu Lab X1 Carbon", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "256x0", "256x256", "0x256"],
      printable_height: 256, gcode_flavor: "marlin2",
      machine_max_speed_x: [500], machine_max_speed_y: [500],
      retraction_length: [0.8], retraction_speed: [30],
    },
  },
  prusa_mk4: {
    id: "prusa_mk4", label: "Prusa MK4", category: "Prusa",
    profile: {
      printer_model: "Original Prusa MK4", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "250x0", "250x210", "0x210"],
      printable_height: 220, gcode_flavor: "marlin2",
      machine_max_speed_x: [400], machine_max_speed_y: [400],
      retraction_length: [0.8], retraction_speed: [35],
    },
  },
  voron_24_350: {
    id: "voron_24_350", label: "Voron 2.4 (350)", category: "Voron",
    profile: {
      printer_model: "Voron 2.4 350", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "350x0", "350x350", "0x350"],
      printable_height: 350, gcode_flavor: "klipper",
      machine_max_speed_x: [500], machine_max_speed_y: [500],
      retraction_length: [1.0], retraction_speed: [35],
    },
  },
  voron_24_300: {
    id: "voron_24_300", label: "Voron 2.4 (300)", category: "Voron",
    profile: {
      printer_model: "Voron 2.4 300", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "300x0", "300x300", "0x300"],
      printable_height: 300, gcode_flavor: "klipper",
      machine_max_speed_x: [500], machine_max_speed_y: [500],
      retraction_length: [1.0], retraction_speed: [35],
    },
  },
  // Sovol — popular budget-to-mid range. SV06 is direct-drive
  // Marlin-based, SV07 is Klipper-based, SV08 is CoreXY/Klipper.
  // Specs from sovol3d.com product pages (cross-checked against
  // OrcaSlicer's bundled profiles where available).
  sovol_sv06: {
    id: "sovol_sv06", label: "Sovol SV06", category: "Sovol",
    profile: {
      printer_model: "Sovol SV06", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "220x0", "220x220", "0x220"],
      printable_height: 250, gcode_flavor: "marlin2",
      machine_max_speed_x: [180], machine_max_speed_y: [180],
      machine_max_speed_z: [10], machine_max_speed_e: [60],
      retraction_length: [0.8], retraction_speed: [40],
    },
  },
  sovol_sv06_plus: {
    id: "sovol_sv06_plus", label: "Sovol SV06 Plus", category: "Sovol",
    profile: {
      printer_model: "Sovol SV06 Plus", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "300x0", "300x300", "0x300"],
      printable_height: 340, gcode_flavor: "marlin2",
      machine_max_speed_x: [180], machine_max_speed_y: [180],
      retraction_length: [0.8], retraction_speed: [40],
    },
  },
  // SV06 Plus "Ace" — 2025 refresh of the SV06 Plus that swaps the
  // Marlin board for a Klipper-based CoreXY platform. Same 300³ build
  // volume but dramatically faster (input-shaper tuned 500mm/s) and
  // direct-drive Sherpa-mini-clone extruder.
  sovol_sv06_plus_ace: {
    id: "sovol_sv06_plus_ace", label: "Sovol SV06 Plus Ace", category: "Sovol",
    profile: {
      printer_model: "Sovol SV06 Plus Ace", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "300x0", "300x300", "0x300"],
      printable_height: 340, gcode_flavor: "klipper",
      machine_max_speed_x: [500], machine_max_speed_y: [500],
      machine_max_speed_z: [12], machine_max_speed_e: [60],
      retraction_length: [0.8], retraction_speed: [40],
    },
  },
  sovol_sv07: {
    id: "sovol_sv07", label: "Sovol SV07", category: "Sovol",
    profile: {
      printer_model: "Sovol SV07", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "220x0", "220x220", "0x220"],
      printable_height: 240, gcode_flavor: "klipper",
      machine_max_speed_x: [500], machine_max_speed_y: [500],
      retraction_length: [0.8], retraction_speed: [40],
    },
  },
  sovol_sv08: {
    id: "sovol_sv08", label: "Sovol SV08", category: "Sovol",
    profile: {
      printer_model: "Sovol SV08", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "350x0", "350x350", "0x350"],
      printable_height: 345, gcode_flavor: "klipper",
      machine_max_speed_x: [700], machine_max_speed_y: [700],
      retraction_length: [0.6], retraction_speed: [40],
    },
  },
  // Sanity-check fallback — still the most-owned hobbyist machine.
  ender_3: {
    id: "ender_3", label: "Creality Ender-3", category: "Creality",
    profile: {
      printer_model: "Creality Ender-3", printer_variant: "0.4",
      nozzle_diameter: [0.4],
      printable_area: ["0x0", "220x0", "220x220", "0x220"],
      printable_height: 250, gcode_flavor: "marlin2",
      machine_max_speed_x: [180], machine_max_speed_y: [180],
      retraction_length: [5], retraction_speed: [40],
    },
  },
  // "Custom" intentionally has empty profile — caller can paste their
  // own OrcaSlicer-exported printer JSON if they're picky.
  custom: {
    id: "custom", label: "Custom / Generic 0.4mm", category: "Custom",
    profile: {
      printer_model: "Custom 0.4mm",
      nozzle_diameter: [0.4], gcode_flavor: "marlin2",
    },
  },
};

// Process presets — these are "intent" templates the user adjusts via
// the four inline tunables. `wall_loops` etc. are OrcaSlicer's own
// keys, kept verbatim so a future "export OrcaSlicer profile" feature
// works without translation.
export const PROCESS_PROFILES = {
  standard: {
    id: "standard", label: "Standard 0.2mm",
    description: "Balanced quality / time. Good first-print pick.",
    profile: {
      layer_height: 0.2, initial_layer_print_height: 0.3,
      wall_loops: 2, top_shell_layers: 4, bottom_shell_layers: 4,
      sparse_infill_density: 15, sparse_infill_pattern: "gyroid",
      enable_support: false, support_type: "tree(auto)",
      print_speed: 100, inner_wall_speed: 60, outer_wall_speed: 50,
      infill_speed: 100, travel_speed: 250,
      ironing: false, brim_type: "no_brim", brim_width: 5,
    },
  },
  fine: {
    id: "fine", label: "Fine 0.12mm",
    description: "Smoother surfaces. ~2× print time.",
    profile: {
      layer_height: 0.12, initial_layer_print_height: 0.2,
      wall_loops: 3, top_shell_layers: 5, bottom_shell_layers: 4,
      sparse_infill_density: 18, sparse_infill_pattern: "gyroid",
      print_speed: 80, inner_wall_speed: 50, outer_wall_speed: 40,
      infill_speed: 90, travel_speed: 250,
      ironing: true, ironing_type: "top",
      brim_type: "no_brim", brim_width: 5,
    },
  },
  draft: {
    id: "draft", label: "Draft 0.28mm",
    description: "Fastest. Use for rough prototypes.",
    profile: {
      layer_height: 0.28, initial_layer_print_height: 0.3,
      wall_loops: 2, top_shell_layers: 3, bottom_shell_layers: 3,
      sparse_infill_density: 10, sparse_infill_pattern: "grid",
      print_speed: 150, inner_wall_speed: 80, outer_wall_speed: 60,
      infill_speed: 150, travel_speed: 300,
      ironing: false, brim_type: "no_brim", brim_width: 5,
    },
  },
  strong: {
    id: "strong", label: "Strong (functional parts)",
    description: "4 perimeters + dense gyroid. Slowest, stiffest.",
    profile: {
      layer_height: 0.2, initial_layer_print_height: 0.3,
      wall_loops: 4, top_shell_layers: 5, bottom_shell_layers: 5,
      sparse_infill_density: 35, sparse_infill_pattern: "gyroid",
      print_speed: 80, inner_wall_speed: 50, outer_wall_speed: 40,
      infill_speed: 90, travel_speed: 250,
      ironing: false, brim_type: "outer_only", brim_width: 5,
    },
  },
};

// Filament presets — temperature / fan / extrusion factor sets. Same
// minimal-overlay principle as printers: we only stamp the keys that
// vary by material and let OrcaSlicer's bundled defaults fill the rest.
export const FILAMENT_PROFILES = {
  pla: {
    id: "pla", label: "PLA",
    profile: {
      filament_type: ["PLA"],
      nozzle_temperature: [210], nozzle_temperature_initial_layer: [215],
      hot_plate_temp: [60], hot_plate_temp_initial_layer: [60],
      cool_plate_temp: [35], textured_plate_temp: [60],
      fan_min_speed: [100], fan_max_speed: [100],
      slow_down_for_layer_cooling: [true],
      filament_max_volumetric_speed: [12],
    },
  },
  petg: {
    id: "petg", label: "PETG",
    profile: {
      filament_type: ["PETG"],
      nozzle_temperature: [240], nozzle_temperature_initial_layer: [240],
      hot_plate_temp: [70], hot_plate_temp_initial_layer: [70],
      fan_min_speed: [30], fan_max_speed: [50],
      filament_max_volumetric_speed: [10],
    },
  },
  abs: {
    id: "abs", label: "ABS",
    profile: {
      filament_type: ["ABS"],
      nozzle_temperature: [255], nozzle_temperature_initial_layer: [255],
      hot_plate_temp: [100], hot_plate_temp_initial_layer: [105],
      fan_min_speed: [0], fan_max_speed: [20],
      filament_max_volumetric_speed: [12],
    },
  },
  tpu: {
    id: "tpu", label: "TPU 95A",
    profile: {
      filament_type: ["TPU"],
      nozzle_temperature: [225], nozzle_temperature_initial_layer: [230],
      hot_plate_temp: [50], hot_plate_temp_initial_layer: [50],
      fan_min_speed: [40], fan_max_speed: [70],
      filament_max_volumetric_speed: [3.5],
    },
  },
  asa: {
    id: "asa", label: "ASA",
    profile: {
      filament_type: ["ASA"],
      nozzle_temperature: [255], nozzle_temperature_initial_layer: [255],
      hot_plate_temp: [100], hot_plate_temp_initial_layer: [105],
      fan_min_speed: [0], fan_max_speed: [10],
      filament_max_volumetric_speed: [12],
    },
  },
};

// Available infill patterns in OrcaSlicer. Drop-down options in the
// inline tunables; the value passed back is the literal string Orca
// expects in `sparse_infill_pattern`.
export const INFILL_PATTERNS = [
  { id: "gyroid",           label: "Gyroid (strong)" },
  { id: "grid",             label: "Grid (crosshatch)" },
  { id: "rectilinear",      label: "Rectilinear ±45°" },
  { id: "triangles",        label: "Triangles" },
  { id: "honeycomb",        label: "Honeycomb (3D)" },
  { id: "concentric",       label: "Concentric" },
  { id: "cubic",            label: "Cubic" },
  { id: "lightning",        label: "Lightning (fast)" },
];

/**
 * Build the three JSON payloads the backend expects from the user's
 * picker selections + four inline tunables (perimeter count, infill %,
 * supports on/off, ironing on/off, infill pattern). The presets stay
 * pristine — we shallow-merge the overrides on top so the caller can
 * tweak any field independently.
 */
// Map our internal printer/process/filament IDs to the bundled
// OrcaSlicer system preset names (resources/profiles/<vendor>/...).
// The BACKEND uses these to load the system JSON, walk the inheritance
// chain, and apply tunable overrides — so we don't have to maintain
// our own (incomplete) printer-spec dictionaries that risk drifting
// from OrcaSlicer's schema and failing its validator.
//
// Falsy entries mean "no system preset available; backend falls back
// to the raw profile dict we POST in `printer_profile`."
const SYSTEM_PRESETS = {
  printer: {
    bambu_a1:      { vendor: "BBL",  name: "Bambu Lab A1 0.4 nozzle" },
    bambu_a1_mini: { vendor: "BBL",  name: "Bambu Lab A1 mini 0.4 nozzle" },
    bambu_p1s:     { vendor: "BBL",  name: "Bambu Lab P1S 0.4 nozzle" },
    bambu_x1c:     { vendor: "BBL",  name: "Bambu Lab X1 Carbon 0.4 nozzle" },
    prusa_mk4:     { vendor: "Prusa", name: "Prusa MK4 0.4 nozzle" },
    prusa_mk4s:    { vendor: "Prusa", name: "Prusa MK4S 0.4 nozzle" },
    sovol_sv06:    { vendor: "Sovol", name: "Sovol SV06 0.4 nozzle" },
    sovol_sv07:    { vendor: "Sovol", name: "Sovol SV07 0.4 nozzle" },
    sovol_sv08:    { vendor: "Sovol", name: "Sovol SV08 0.4 nozzle" },
    creality_ender3: { vendor: "Creality", name: "Creality Ender-3 0.4 nozzle" },
    voron24:       { vendor: "Voron", name: "Voron 2.4 350 0.4 nozzle" },
  },
  process: {
    // Process presets are printer-specific (named "@BBL A1", "@Prusa MK4", …).
    // The backend can't statically pre-pick these — we look up by
    // {process layer-height + printer-key} pair at slice time.
    // Encoded here as a function rather than a flat map so the printer
    // context is available.
    standard: { vendor: "BBL", name: "0.20mm Standard @BBL A1" },
    quality:  { vendor: "BBL", name: "0.16mm Optimal @BBL A1" },
    draft:    { vendor: "BBL", name: "0.28mm Draft @BBL A1" },
    ultra:    { vendor: "BBL", name: "0.12mm Fine @BBL A1" },
  },
  filament: {
    pla:   { vendor: "BBL", name: "Bambu PLA Basic @BBL A1" },
    petg:  { vendor: "BBL", name: "Bambu PETG Basic @BBL A1" },
    abs:   { vendor: "BBL", name: "Bambu ABS @BBL A1" },
    tpu:   { vendor: "BBL", name: "Bambu TPU 95A @BBL A1" },
  },
};

function lookupPreset(category, id) {
  return SYSTEM_PRESETS[category]?.[id] || null;
}

export function buildOrcaPayload({
  printerId, processId, filamentId,
  wallLoops, sparseInfillDensity, sparseInfillPattern,
  enableSupport, ironing,
}) {
  const printer = PRINTER_PROFILES[printerId] || PRINTER_PROFILES.custom;
  const process = PROCESS_PROFILES[processId] || PROCESS_PROFILES.standard;
  const filament = FILAMENT_PROFILES[filamentId] || FILAMENT_PROFILES.pla;

  // Merge process preset with user tunables. Each tunable is allowed
  // to be undefined → fall through to the preset.
  const processProfile = {
    ...process.profile,
    ...(wallLoops != null ? { wall_loops: wallLoops } : {}),
    ...(sparseInfillDensity != null ? { sparse_infill_density: sparseInfillDensity } : {}),
    ...(sparseInfillPattern ? { sparse_infill_pattern: sparseInfillPattern } : {}),
    ...(enableSupport != null ? { enable_support: enableSupport } : {}),
    ...(ironing != null ? { ironing } : {}),
  };

  // OrcaSlicer's CLI is strict about profile-JSON metadata. Every JSON
  // it loads MUST declare four header fields, or its C++ validator
  // throws `loading json file X's from <empty> is unsupported` and
  // exits 251. (We hit this in production v1.0 of the slice flow.)
  //   • type           — one of "machine" | "process" | "filament"
  //   • name           — display name (any string)
  //   • from           — provenance, must be "Default" | "System" | "User"
  //   • instantiation  — "true" string (yes, a string, not a bool) so
  //                       Orca treats the JSON as a concrete instance
  //                       rather than a base template
  //
  // Adding them here (rather than in each individual preset) keeps the
  // preset JSONs focused on actual slicer params and prevents the
  // header from drifting between presets.
  const withMeta = (profile, type, name) => ({
    type,
    name,
    from: "User",
    instantiation: "true",
    ...profile,
  });

  return {
    printerProfile: withMeta(printer.profile, "machine", printer.label),
    processProfile: withMeta(processProfile, "process", process.label),
    filamentProfile: withMeta(filament.profile, "filament", filament.label),
    // Echo back the resolved labels so the slicer status panel can
    // show what was actually sent (rather than the IDs).
    summary: {
      printer: printer.label,
      process: process.label,
      filament: filament.label,
    },
  };
}

// Grouped printer list for a categorised <select> in the UI — keeps
// twelve+ models legible.
export function getPrinterGroups() {
  const groups = {};
  for (const p of Object.values(PRINTER_PROFILES)) {
    (groups[p.category] = groups[p.category] || []).push(p);
  }
  return groups;
}

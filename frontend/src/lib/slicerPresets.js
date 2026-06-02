// Iter-81: Material/use-case presets. One-click "quick start" for the
// SlicerPopover. Each preset bundles slicer knobs (perimeters, infill,
// pattern, supports, ironing) + filament profile + temperatures so a
// user can pick "PETG Strong" or "PLA Fast" instead of tuning 8 fields
// individually.
//
// Presets stay opinionated — they target the *common* good print for
// the material and use-case, not a fine-tuned aerospace part. Each
// preset documents WHY its values are what they are so users can
// reason about whether the preset fits their part.
//
// Adding a preset is a structural change to ForgeSlicer's UX; we keep
// the list small and curated (~7 entries) so the popover stays a
// single screen. Power users can still override per-knob after
// picking a preset; selecting a preset doesn't lock them in.

export const PRESET_CATEGORIES = [
  {
    id: "pla_balanced",
    label: "PLA · Balanced",
    description: "Default for most prints. 2 walls, 15 % gyroid, light supports off — quick + strong enough for fit-checks and household parts.",
    badge: "DEFAULT",
    badgeClass: "bg-slate-700 text-slate-200",
    // OrcaSlicer profile selectors (bundled).
    orcaProcessId: "default_0_2mm",
    orcaFilamentId: "generic_pla",
    // Slice-settings knobs (used by the built-in engine, and as
    // defaults for the OrcaSlicer-engine UI sliders).
    settings: {
      perimeters: 2,
      infillPercent: 15,
      infillPattern: "gyroid",
      layerHeight: 0.2,
      nozzleTemp: 210,
      bedTemp: 60,
      topLayers: 4,
      bottomLayers: 4,
    },
    // Orca-engine extras.
    orca: { walls: 2, infillPct: 15, pattern: "gyroid", supports: false, ironing: false },
  },
  {
    id: "pla_fast",
    label: "PLA · Fast",
    description: "Speed-tuned for prototypes. 2 walls, 10 % gyroid, 0.28 mm layers, no ironing. ~40 % faster than Balanced at the cost of visible layer lines.",
    badge: "SPEED",
    badgeClass: "bg-emerald-600/30 text-emerald-300 border border-emerald-500/50",
    orcaProcessId: "draft_0_28mm",
    orcaFilamentId: "generic_pla",
    settings: {
      perimeters: 2,
      infillPercent: 10,
      infillPattern: "gyroid",
      layerHeight: 0.28,
      nozzleTemp: 215,
      bedTemp: 60,
      topLayers: 3,
      bottomLayers: 3,
    },
    orca: { walls: 2, infillPct: 10, pattern: "gyroid", supports: false, ironing: false },
  },
  {
    id: "pla_quality",
    label: "PLA · Quality",
    description: "Fine-detail printing for cosmetic parts. 3 walls, 20 % grid, 0.12 mm layers, ironing on. ~3× slower but visibly smoother top surfaces.",
    badge: "QUALITY",
    badgeClass: "bg-blue-600/30 text-blue-300 border border-blue-500/50",
    orcaProcessId: "fine_0_12mm",
    orcaFilamentId: "generic_pla",
    settings: {
      perimeters: 3,
      infillPercent: 20,
      infillPattern: "grid",
      layerHeight: 0.12,
      nozzleTemp: 210,
      bedTemp: 60,
      topLayers: 6,
      bottomLayers: 5,
    },
    orca: { walls: 3, infillPct: 20, pattern: "grid", supports: false, ironing: true },
  },
  {
    id: "petg_strong",
    label: "PETG · Strong",
    description: "Mechanical / load-bearing parts. 4 walls, 30 % gyroid, slightly higher infill density for impact resistance. Brackets, hinges, mounting hardware.",
    badge: "STRONG",
    badgeClass: "bg-orange-600/30 text-orange-300 border border-orange-500/50",
    orcaProcessId: "default_0_2mm",
    orcaFilamentId: "generic_petg",
    settings: {
      perimeters: 4,
      infillPercent: 30,
      infillPattern: "gyroid",
      layerHeight: 0.2,
      nozzleTemp: 235,
      bedTemp: 80,
      topLayers: 5,
      bottomLayers: 5,
    },
    orca: { walls: 4, infillPct: 30, pattern: "gyroid", supports: false, ironing: false },
  },
  {
    id: "petg_balanced",
    label: "PETG · Balanced",
    description: "General PETG with standard settings. 3 walls, 18 % gyroid, slightly more bed adhesion margin than PLA. Outdoor parts, food-contact-adjacent.",
    badge: "PETG",
    badgeClass: "bg-cyan-600/30 text-cyan-300 border border-cyan-500/50",
    orcaProcessId: "default_0_2mm",
    orcaFilamentId: "generic_petg",
    settings: {
      perimeters: 3,
      infillPercent: 18,
      infillPattern: "gyroid",
      layerHeight: 0.2,
      nozzleTemp: 235,
      bedTemp: 80,
      topLayers: 4,
      bottomLayers: 4,
    },
    orca: { walls: 3, infillPct: 18, pattern: "gyroid", supports: false, ironing: false },
  },
  {
    id: "abs_durable",
    label: "ABS · Durable",
    description: "High-temp / high-stress parts. 4 walls, 25 % grid, 245 °C nozzle, 100 °C bed. Needs an enclosed printer — warp risk on open frames.",
    badge: "TOUGH",
    badgeClass: "bg-rose-600/30 text-rose-300 border border-rose-500/50",
    orcaProcessId: "default_0_2mm",
    orcaFilamentId: "generic_abs",
    settings: {
      perimeters: 4,
      infillPercent: 25,
      infillPattern: "grid",
      layerHeight: 0.2,
      nozzleTemp: 245,
      bedTemp: 100,
      topLayers: 5,
      bottomLayers: 5,
    },
    orca: { walls: 4, infillPct: 25, pattern: "grid", supports: false, ironing: false },
  },
  {
    id: "tpu_flexible",
    label: "TPU · Flexible",
    description: "Flexible parts. 3 walls (rigidity), 5 % gyroid (low infill = floppy), slow + cool. Phone cases, gaskets, watch bands.",
    badge: "FLEX",
    badgeClass: "bg-purple-600/30 text-purple-300 border border-purple-500/50",
    orcaProcessId: "default_0_2mm",
    orcaFilamentId: "generic_tpu",
    settings: {
      perimeters: 3,
      infillPercent: 5,
      infillPattern: "gyroid",
      layerHeight: 0.2,
      nozzleTemp: 225,
      bedTemp: 50,
      topLayers: 4,
      bottomLayers: 4,
    },
    orca: { walls: 3, infillPct: 5, pattern: "gyroid", supports: false, ironing: false },
  },
];

// Looks up a preset by id. Returns null when unknown (so the caller
// can short-circuit instead of crashing on a stale localStorage key).
export function getPreset(id) {
  return PRESET_CATEGORIES.find((p) => p.id === id) || null;
}

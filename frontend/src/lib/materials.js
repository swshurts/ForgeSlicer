// Recommended filament / material catalog. Stored as a `material` string on
// gallery records (default "pla"). Catalog can grow without DB migrations —
// the backend just stores the id as free-text, lowercased + truncated.
export const MATERIALS = [
  { id: "pla",   label: "PLA",        description: "Easy general-purpose printing", tint: "emerald" },
  { id: "petg",  label: "PETG",       description: "Tough, mildly flexible — good for outdoor / functional parts", tint: "cyan" },
  { id: "abs",   label: "ABS",        description: "High temp / impact resistance — enclosure printing recommended", tint: "amber" },
  { id: "asa",   label: "ASA",        description: "UV-resistant ABS variant — good for outdoor parts", tint: "amber" },
  { id: "tpu",   label: "TPU (Flex)", description: "Flexible filament — gaskets, grips, dampers", tint: "rose" },
  { id: "nylon", label: "Nylon",      description: "Strong, slippery, hygroscopic — gears and bearings", tint: "violet" },
  { id: "pc",    label: "Polycarbonate", description: "Tough, transparent option for engineering parts", tint: "violet" },
  { id: "carbon", label: "Carbon-fibre filled", description: "Stiff, lightweight — needs hardened nozzle", tint: "slate" },
  { id: "wood",  label: "Wood-filled PLA", description: "Decorative wood-look prints", tint: "amber" },
  { id: "resin", label: "Resin (SLA)", description: "High-detail SLA — miniatures, jewellery", tint: "rose" },
  { id: "any",   label: "Any",        description: "Filament-agnostic — works with whatever you've got loaded", tint: "slate" },
];

export const DEFAULT_MATERIAL_ID = "pla";

export const getMaterial = (id) =>
  MATERIALS.find((m) => m.id === id) || { id: id || "pla", label: id || "PLA", description: "", tint: "slate" };

"""Printer profile catalog.

The catalog is keyed by `printer_id` and organized by SLICER FAMILY (the
slicer determines the 3MF dialect + layer-change G-code template, so
that's the right primary axis).

Each profile carries:
  • bed_x_mm / bed_y_mm — build-plate size (for compatibility warnings)
  • max_z_mm           — Z height (rarely a limit for lithophanes)
  • default_layer_height_mm
  • multi_tool         — True for AMS / MMU / CFS / ACE / IFS / IDEX
                         systems. Multi-tool printers receive `T<n>`
                         tool-change commands instead of `M600` pauses.
  • tool_slots         — number of auto-change lanes (AMS=4, MMU3=5,
                         Prusa XL=5, IDEX=2). Swaps beyond this count
                         fall back to M600 pauses.
  • nozzle_sizes_mm    — nozzle diameters the manufacturer sells for
                         this machine. Drives the nozzle dropdown and
                         layer-height constraints in the UI.
  • default_nozzle_mm  — the nozzle the machine ships with (0.4 for all
                         current consumer FDM printers).
  • slicer_family      — 'orca' | 'prusa' | 'super' | 'cura' | 'marlin'
  • supported_formats  — subset of {"stl", "3mf", "swaps"}. Some printers
                         only really make sense with 3MF (Flashforge's
                         Orca fork hard-relies on .gcode.3mf).

Specs sourced from manufacturer datasheets (2024–2026 lineups).
"""

from __future__ import annotations

from typing import Dict, List, Literal, Tuple, TypedDict


class PrinterProfile(TypedDict):
    id: str
    name: str
    manufacturer: str
    slicer_family: Literal["orca", "prusa", "super", "cura", "marlin"]
    bed_x_mm: int
    bed_y_mm: int
    max_z_mm: int
    default_layer_height_mm: float
    multi_tool: bool
    tool_slots: int
    nozzle_sizes_mm: List[float]
    default_nozzle_mm: float
    supported_formats: List[str]
    notes: str


# Common nozzle lineups (manufacturer-sold sizes).
_BAMBU_NOZZLES = [0.2, 0.4, 0.6, 0.8]      # Bambu hardened/stainless hotends
_PRUSA_NOZZLES = [0.25, 0.4, 0.6, 0.8]     # Nextruder / V6 lineup
_K_SERIES_NOZZLES = [0.4, 0.6, 0.8]        # Creality "unicorn" quick-swap
_STD_NOZZLES = [0.2, 0.4, 0.6, 0.8]        # common MK8/E3D-style brass
_OPEN_NOZZLES = [0.2, 0.25, 0.4, 0.6, 0.8]  # open ecosystems (Voron, generic)


def _p(
    id_: str,
    name: str,
    manufacturer: str,
    family: str,
    bed: Tuple[int, int, int],
    *,
    layer: float = 0.12,
    multi: bool = False,
    slots: int = 4,
    nozzles: List[float] | None = None,
    formats: List[str] | None = None,
    notes: str = "",
) -> PrinterProfile:
    return {
        "id": id_,
        "name": name,
        "manufacturer": manufacturer,
        "slicer_family": family,  # type: ignore[typeddict-item]
        "bed_x_mm": bed[0],
        "bed_y_mm": bed[1],
        "max_z_mm": bed[2],
        "default_layer_height_mm": layer,
        "multi_tool": multi,
        "tool_slots": slots,
        "nozzle_sizes_mm": nozzles or _STD_NOZZLES,
        "default_nozzle_mm": 0.4,
        "supported_formats": formats or ["stl", "3mf", "swaps"],
        "notes": notes,
    }


_PROFILE_LIST: List[PrinterProfile] = [
    # ------ OrcaSlicer family (Bambu Studio + Orca forks) -------------------
    _p("generic_orca", "Generic FDM (OrcaSlicer)", "Generic", "orca",
       (220, 220, 250), nozzles=_OPEN_NOZZLES,
       notes="Catch-all profile for any printer using OrcaSlicer."),

    # Bambu Lab
    _p("bambu_a1_mini", "Bambu A1 mini", "Bambu Lab", "orca",
       (180, 180, 180), nozzles=_BAMBU_NOZZLES,
       notes="Single-extruder. AMS lite optional — assumes manual swaps."),
    _p("bambu_a1", "Bambu A1 (with AMS lite)", "Bambu Lab", "orca",
       (256, 256, 256), multi=True, nozzles=_BAMBU_NOZZLES,
       notes="AMS lite (4 spools). Tool changes via T0–T3, no M600."),
    _p("bambu_p1p", "Bambu P1P (with AMS)", "Bambu Lab", "orca",
       (256, 256, 256), multi=True, nozzles=_BAMBU_NOZZLES,
       notes="AMS optional — pick Generic Orca instead if you swap by hand."),
    _p("bambu_p1s", "Bambu P1S (with AMS)", "Bambu Lab", "orca",
       (256, 256, 256), multi=True, nozzles=_BAMBU_NOZZLES,
       notes="AMS-equipped. Tool changes via T0–T3."),
    _p("bambu_x1c", "Bambu X1C (with AMS)", "Bambu Lab", "orca",
       (256, 256, 256), multi=True, nozzles=_BAMBU_NOZZLES,
       notes="AMS-equipped flagship. Tool changes via T0–T3."),
    _p("bambu_x1e", "Bambu X1E (with AMS)", "Bambu Lab", "orca",
       (256, 256, 256), multi=True, nozzles=_BAMBU_NOZZLES,
       notes="Enterprise X1. Same AMS flow as the X1C."),
    _p("bambu_h2d", "Bambu H2D (AMS 2 Pro)", "Bambu Lab", "orca",
       (350, 320, 325), multi=True, nozzles=_BAMBU_NOZZLES,
       notes="Dual-nozzle flagship. AMS 2 Pro lanes via T0–T3."),

    # Creality (Orca-Creality / Creality Print)
    _p("creality_k1", "Creality K1", "Creality", "orca",
       (220, 220, 250), layer=0.16, nozzles=_K_SERIES_NOZZLES,
       notes="Klipper-based, OrcaSlicer-Creality fork."),
    _p("creality_k1c", "Creality K1C", "Creality", "orca",
       (220, 220, 250), layer=0.16, nozzles=_K_SERIES_NOZZLES,
       notes="K1 with quick-swap unicorn nozzle. Manual swaps via M600."),
    _p("creality_k1_se", "Creality K1 SE", "Creality", "orca",
       (220, 220, 265), layer=0.16, nozzles=_K_SERIES_NOZZLES,
       notes="Open-frame K1. Manual swaps via M600."),
    _p("creality_k1_max", "Creality K1 Max", "Creality", "orca",
       (300, 300, 300), layer=0.16, nozzles=_K_SERIES_NOZZLES,
       notes="300mm K1. Manual swaps via M600."),
    _p("creality_k2_plus", "Creality K2 Plus (with CFS)", "Creality", "orca",
       (350, 350, 350), layer=0.16, multi=True, nozzles=_K_SERIES_NOZZLES,
       notes="CFS 4-spool unit. Tool changes via T0–T3."),
    _p("creality_hi", "Creality Hi (with CFS)", "Creality", "orca",
       (260, 260, 300), layer=0.16, multi=True, nozzles=_K_SERIES_NOZZLES,
       notes="CFS-compatible bed-slinger. Tool changes via T0–T3."),
    _p("creality_ender3_v3", "Creality Ender-3 V3", "Creality", "orca",
       (220, 220, 250), layer=0.16, nozzles=_K_SERIES_NOZZLES,
       notes="CoreXZ. Manual swaps via M600."),
    _p("creality_ender3_v3_ke", "Creality Ender-3 V3 KE", "Creality", "orca",
       (220, 220, 240), layer=0.16, nozzles=_K_SERIES_NOZZLES,
       notes="Klipper-based. Manual swaps via M600."),
    _p("creality_ender3_v3_se", "Creality Ender-3 V3 SE", "Creality", "orca",
       (220, 220, 250), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Budget bed-slinger. Manual swaps via M600."),
    _p("creality_cr10_se", "Creality CR-10 SE", "Creality", "orca",
       (220, 220, 265), layer=0.16, nozzles=_K_SERIES_NOZZLES,
       notes="Linear-rail bed-slinger. Manual swaps via M600."),

    # Elegoo
    _p("elegoo_neptune4", "Elegoo Neptune 4 / 4 Pro", "Elegoo", "orca",
       (225, 225, 265), layer=0.16, nozzles=_STD_NOZZLES,
       notes="OrcaSlicer-Elegoo. Manual filament swaps."),
    _p("elegoo_neptune4_plus", "Elegoo Neptune 4 Plus", "Elegoo", "orca",
       (320, 320, 385), layer=0.16, nozzles=_STD_NOZZLES,
       notes="320mm Neptune. Manual swaps via M600."),
    _p("elegoo_neptune4_max", "Elegoo Neptune 4 Max", "Elegoo", "orca",
       (420, 420, 480), layer=0.16, nozzles=_STD_NOZZLES,
       notes="420mm Neptune. Manual swaps via M600."),
    _p("elegoo_centauri", "Elegoo Centauri Carbon", "Elegoo", "orca",
       (256, 256, 256), layer=0.16, nozzles=_STD_NOZZLES,
       notes="OrcaSlicer-Elegoo CoreXY. Manual swaps via M600."),

    # Anycubic
    _p("anycubic_kobra2", "Anycubic Kobra 2 Pro/Plus", "Anycubic", "orca",
       (220, 220, 250), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Runs OrcaSlicer fork. Manual swaps via M600."),
    _p("anycubic_kobra3", "Anycubic Kobra 3 Combo (ACE Pro)", "Anycubic", "orca",
       (250, 250, 260), layer=0.16, multi=True, nozzles=_STD_NOZZLES,
       notes="ACE Pro 4-spool dryer/changer. Tool changes via T0–T3."),
    _p("anycubic_kobra3_max", "Anycubic Kobra 3 Max (ACE Pro)", "Anycubic", "orca",
       (420, 420, 500), layer=0.16, multi=True, nozzles=_STD_NOZZLES,
       notes="420mm Kobra with ACE Pro. Tool changes via T0–T3."),
    _p("anycubic_kobra_s1", "Anycubic Kobra S1 Combo (ACE Pro)", "Anycubic", "orca",
       (250, 250, 250), layer=0.16, multi=True, nozzles=_STD_NOZZLES,
       notes="Enclosed CoreXY with ACE Pro. Tool changes via T0–T3."),

    # Sovol
    _p("sovol_sv06", "Sovol SV06", "Sovol", "orca",
       (220, 220, 250), layer=0.16, nozzles=_OPEN_NOZZLES,
       notes="Open-source Mk4-style. Manual swaps via M600."),
    _p("sovol_sv06_plus", "Sovol SV06 Plus", "Sovol", "orca",
       (300, 300, 340), layer=0.16, nozzles=_OPEN_NOZZLES,
       notes="300mm SV06. Manual swaps via M600."),
    _p("sovol_sv07", "Sovol SV07", "Sovol", "orca",
       (220, 220, 250), layer=0.16, nozzles=_OPEN_NOZZLES,
       notes="Klipper-based, runs OrcaSlicer. Manual filament swaps."),
    _p("sovol_sv08", "Sovol SV08", "Sovol", "orca",
       (350, 350, 345), layer=0.16, nozzles=_OPEN_NOZZLES,
       notes="Voron-style 350mm cube, runs OrcaSlicer."),

    # QIDI
    _p("qidi_q1_pro", "QIDI Q1 Pro", "QIDI Tech", "orca",
       (245, 245, 240), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Enclosed CoreXY. Manual swaps via M600."),
    _p("qidi_plus4", "QIDI Plus4", "QIDI Tech", "orca",
       (305, 305, 280), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Heated chamber. Add the QIDI Box profile for auto swaps."),
    _p("qidi_plus4_box", "QIDI Plus4 (with QIDI Box)", "QIDI Tech", "orca",
       (305, 305, 280), layer=0.16, multi=True, nozzles=_STD_NOZZLES,
       notes="QIDI Box 4-spool changer. Tool changes via T0–T3."),
    _p("qidi_x_max3", "QIDI X-Max 3", "QIDI Tech", "orca",
       (325, 325, 315), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Large enclosed CoreXY. Manual swaps via M600."),

    # Flashforge (Orca-Flashforge — 3MF is the realistic path)
    _p("flashforge_ad5m", "Flashforge Adventurer 5M / 5M Pro", "Flashforge", "orca",
       (220, 220, 220), layer=0.16, nozzles=[0.25, 0.4, 0.6, 0.8],
       formats=["3mf"],
       notes="Orca-Flashforge fork. Use the 3MF — the printer expects "
             "the project format, not raw STL+swap notes."),
    _p("flashforge_ad5x", "Flashforge AD5X (IFS multi-color)", "Flashforge", "orca",
       (220, 220, 220), layer=0.16, multi=True,
       nozzles=[0.25, 0.4, 0.6, 0.8], formats=["3mf"],
       notes="IFS 4-spool system. Tool changes via T0–T3; 3MF only."),

    # Other Orca-friendly machines
    _p("ankermake_m5", "AnkerMake M5", "AnkerMake", "orca",
       (235, 235, 250), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Runs OrcaSlicer community profiles. Manual swaps via M600."),
    _p("ankermake_m5c", "AnkerMake M5C", "AnkerMake", "orca",
       (220, 220, 250), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Compact M5. Manual swaps via M600."),
    _p("artillery_sidewinder_x4_plus", "Artillery Sidewinder X4 Plus",
       "Artillery", "orca", (300, 300, 400), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Klipper bed-slinger. Manual swaps via M600."),
    _p("snapmaker_j1s", "Snapmaker J1s (IDEX)", "Snapmaker", "orca",
       (300, 200, 200), layer=0.16, multi=True, slots=2, nozzles=_STD_NOZZLES,
       notes="IDEX dual extruder — 2 colors via T0/T1, extra swaps M600."),
    _p("two_trees_sk1", "Two Trees SK1", "Two Trees", "orca",
       (256, 256, 256), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Klipper CoreXY. Manual swaps via M600."),
    _p("kingroon_kp3s_pro", "Kingroon KP3S Pro", "Kingroon", "orca",
       (200, 200, 200), layer=0.16, nozzles=_STD_NOZZLES,
       notes="Compact budget printer. Manual swaps via M600."),

    # ------ PrusaSlicer family ----------------------------------------------
    _p("prusa_mk3s", "Prusa i3 MK3S+", "Prusa Research", "prusa",
       (250, 210, 210), layer=0.15, nozzles=_PRUSA_NOZZLES,
       notes="V6 hotend. Manual swaps via M600 (built-in)."),
    _p("prusa_mk4", "Prusa MK4 / MK4S", "Prusa Research", "prusa",
       (250, 210, 220), layer=0.15, nozzles=_PRUSA_NOZZLES,
       notes="Single-extruder. Manual swaps via M600 (built-in)."),
    _p("prusa_mk4_mmu3", "Prusa MK4S + MMU3", "Prusa Research", "prusa",
       (250, 210, 220), layer=0.15, multi=True, slots=5,
       nozzles=_PRUSA_NOZZLES,
       notes="MMU3 5-lane changer. Tool changes via T0–T4."),
    _p("prusa_core_one", "Prusa CORE One", "Prusa Research", "prusa",
       (250, 220, 270), layer=0.15, nozzles=_PRUSA_NOZZLES,
       notes="Enclosed CoreXY. Manual swaps via M600; MMU3 optional."),
    _p("prusa_core_one_l", "Prusa CORE One L", "Prusa Research", "prusa",
       (300, 300, 330), layer=0.15, nozzles=_PRUSA_NOZZLES,
       notes="Large enclosed CoreXY. Manual swaps via M600."),
    _p("prusa_mini", "Prusa MINI+", "Prusa Research", "prusa",
       (180, 180, 180), layer=0.15, nozzles=_PRUSA_NOZZLES,
       notes="Compact. Same M600 swap flow as MK4."),
    _p("prusa_xl", "Prusa XL (5-tool)", "Prusa Research", "prusa",
       (360, 360, 360), layer=0.15, multi=True, slots=5,
       nozzles=_PRUSA_NOZZLES,
       notes="Multi-toolhead. Tool changes via T0–T4 (no M600)."),

    # ------ SuperSlicer family (Voron / Klipper DIY) -------------------------
    _p("voron_02", "Voron 0.2", "Voron", "super",
       (120, 120, 120), layer=0.2, nozzles=_OPEN_NOZZLES,
       notes="Klipper micro CoreXY. Manual swaps via M600."),
    _p("voron_trident", "Voron Trident (300)", "Voron", "super",
       (300, 300, 250), layer=0.2, nozzles=_OPEN_NOZZLES,
       notes="Klipper. SuperSlicer or Orca; manual swaps."),
    _p("voron_24", "Voron 2.4 (350)", "Voron", "super",
       (350, 350, 350), layer=0.2, nozzles=_OPEN_NOZZLES,
       notes="Klipper. Most builders use SuperSlicer; manual swaps."),
    _p("ratrig_vcore3", "RatRig V-Core 3 (300)", "RatRig", "super",
       (300, 300, 300), layer=0.2, nozzles=_OPEN_NOZZLES,
       notes="Klipper CoreXY kit. Manual swaps via M600."),

    # ------ Cura family -------------------------------------------------------
    _p("ultimaker_s3", "Ultimaker S3 / S5", "Ultimaker", "cura",
       (230, 190, 200), layer=0.15, multi=True, slots=2,
       nozzles=[0.25, 0.4, 0.6, 0.8],
       notes="Dual-extruder S3/S5. Cura-only — see swap.txt OPTION B."),
    _p("creality_ender3_v2", "Creality Ender-3 V2", "Creality", "cura",
       (220, 220, 250), layer=0.2, nozzles=_STD_NOZZLES,
       notes="MK8-style brass nozzles. M600 needs firmware support — "
             "use the Cura post-process script otherwise."),

    # ------ Generic Marlin fallback ------------------------------------------
    _p("generic_marlin", "Generic Marlin FDM", "Generic", "marlin",
       (220, 220, 250), layer=0.2, nozzles=_OPEN_NOZZLES,
       notes="Use OPTION C raw-M600 G-code if your slicer can't template."),
]

PRINTER_PROFILES: Dict[str, PrinterProfile] = {p["id"]: p for p in _PROFILE_LIST}


DEFAULT_PRINTER_ID = "generic_orca"
DEFAULT_NOZZLE_MM = 0.4

# Layer height window as a fraction of nozzle diameter. The classic
# guidance is 25%–80% of Ø: below 25% extrusion gets inconsistent,
# above 80% layers no longer bond reliably.
NOZZLE_LAYER_MIN_RATIO = 0.25
NOZZLE_LAYER_MAX_RATIO = 0.80


def nozzle_layer_bounds(nozzle_mm: float) -> Tuple[float, float]:
    """Practical (min, max) layer height for a nozzle diameter."""
    return (
        round(nozzle_mm * NOZZLE_LAYER_MIN_RATIO, 3),
        round(nozzle_mm * NOZZLE_LAYER_MAX_RATIO, 3),
    )


def get_profile(printer_id: str) -> PrinterProfile:
    """Return a printer profile by id, falling back to the default."""
    return PRINTER_PROFILES.get(printer_id) or PRINTER_PROFILES[DEFAULT_PRINTER_ID]


def list_profiles() -> List[PrinterProfile]:
    """List all printer profiles sorted by slicer family, then name."""
    return sorted(
        PRINTER_PROFILES.values(),
        key=lambda p: (p["slicer_family"], p["manufacturer"], p["name"]),
    )


def build_layer_change_gcode(
    profile: PrinterProfile,
    swap_layer_indices: List[int],
) -> str:
    """Generate the layer-change G-code snippet appropriate for this
    printer.

    Multi-tool printers (Bambu AMS, Creality CFS, Anycubic ACE,
    Prusa XL/MMU3, IDEX) get `T<n>` tool-change commands — the slicer
    pre-configures the lanes and the printer auto-swaps.

    Single-extruder printers get `M600` filament-change pauses — the
    user manually swaps filament when the printer pauses.
    """
    if not swap_layer_indices:
        return ""

    if profile["multi_tool"]:
        # T0 is the BASE filament (loaded before print starts).
        # Each subsequent swap moves to the next tool slot. Slots beyond
        # the machine's lane count would error on the printer, so we
        # fall back to a manual M600 pause with a comment marker.
        max_tools = int(profile.get("tool_slots", 4))
        lines: List[str] = []
        for slot, idx in enumerate(swap_layer_indices):
            tool = slot + 1
            if tool >= max_tools:
                # Out of tool slots — fall back to an M600 manual pause so
                # the user still gets a swap prompt rather than a printer
                # error.
                lines.append(
                    f"{{if layer_num == {idx}}}M600 ; out of AMS slots{{endif}}"
                )
            else:
                lines.append(f"{{if layer_num == {idx}}}T{tool}{{endif}}")
        return "\n".join(lines)

    return "\n".join(
        f"{{if layer_num == {idx}}}M600{{endif}}"
        for idx in swap_layer_indices
    )


def fits_on_bed(profile: PrinterProfile, width_mm: float, height_mm: float) -> bool:
    """Returns True if a design with width × height fits on this printer's
    bed (with a small 5mm safety margin)."""
    return (
        width_mm <= profile["bed_x_mm"] - 5
        and height_mm <= profile["bed_y_mm"] - 5
    )

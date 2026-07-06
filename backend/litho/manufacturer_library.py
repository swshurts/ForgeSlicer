"""Curated manufacturer-specific filament catalog.

Each entry represents a publicly available PLA or PETG SKU from a named
brand. We capture brand, sku name, material, hex (taken from manufacturer
marketing swatches when published, otherwise approximated from product
photos), transmission distance (mm — Hueforge-compatible) and a coarse
finish classifier so the closest-match UI can surface both matte and
gloss variants of the same color.

Approximate TD heuristics used when the brand doesn't publish a number:
  PLA:
    White / cream  : 4.5 – 6.0   (matte ≈ −0.5)
    Light pastels  : 2.5 – 3.5
    Yellow         : 1.8 – 2.2
    Orange / pink  : 1.4 – 1.8
    Red / magenta  : 1.2 – 1.5
    Green          : 1.3 – 1.7
    Blue / purple  : 1.0 – 1.4
    Browns / muted : 0.9 – 1.2
    Black / dark   : 0.7 – 0.9
    Transparent    : 8   – 12
  PETG (more translucent than PLA at the same pigment level):
    White          : 5.5 – 7.0
    Colors         : 2.0 – 4.0
    Black          : 0.9 – 1.1
    Transparent    : 10  – 14

This is a *starter* catalog. Users can extend it via the private-library
endpoints (per-user) or suggest a missing SKU via the suggestion endpoint
for moderation into the global list.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class CatalogFilament:
    id: str           # stable, slug-form "brand-name"
    brand: str
    name: str
    hex: str          # "#RRGGBB"
    td: float
    finish: str       # "gloss" | "matte" | "silk" | "transparent"
    material: str     # "PLA" | "PETG"

    def as_dict(self) -> dict:
        # Local import keeps manufacturer_library.py import-cycle-free.
        from cost_estimator import price_per_kg_usd
        return {
            "id": self.id,
            "brand": self.brand,
            "name": self.name,
            "hex": self.hex.upper(),
            "td": round(self.td, 2),
            "finish": self.finish,
            "material": self.material,
            "price_per_kg_usd": price_per_kg_usd(
                self.material, self.brand, self.finish,
            ),
        }


def _f(
    brand: str,
    name: str,
    hex_: str,
    td: float,
    finish: str = "gloss",
    material: str = "PLA",
) -> CatalogFilament:
    slug = (brand + "-" + name).lower().replace(" ", "-").replace("/", "-")
    slug = "".join(c if c.isalnum() or c == "-" else "" for c in slug)
    return CatalogFilament(slug, brand, name, hex_, td, finish, material)


def _petg(brand: str, name: str, hex_: str, td: float,
          finish: str = "gloss") -> CatalogFilament:
    return _f(brand, name, hex_, td, finish, material="PETG")


# ---------------------------------------------------------------------------
# Bambu Lab — PLA Basic / Matte / Silk+ / PETG HF
# ---------------------------------------------------------------------------
BAMBU = [
    _f("Bambu Lab", "PLA Basic Jade White",       "#F4F5F0", 4.8),
    _f("Bambu Lab", "PLA Basic Bone White",       "#EAE2D0", 4.6),
    _f("Bambu Lab", "PLA Basic Black",            "#000000", 0.8),
    _f("Bambu Lab", "PLA Basic Silver",           "#A6A9AA", 1.6),
    _f("Bambu Lab", "PLA Basic Gray",             "#8E9089", 1.4),
    _f("Bambu Lab", "PLA Basic Red",              "#C12E1F", 1.3),
    _f("Bambu Lab", "PLA Basic Sunflower Yellow", "#FEC600", 1.9),
    _f("Bambu Lab", "PLA Basic Orange",           "#FF6A13", 1.5),
    _f("Bambu Lab", "PLA Basic Magenta",          "#EC008C", 1.5),
    _f("Bambu Lab", "PLA Basic Pink",             "#F55A74", 1.7),
    _f("Bambu Lab", "PLA Basic Bambu Green",      "#00AE42", 1.4),
    _f("Bambu Lab", "PLA Basic Cyan",             "#0086D6", 1.3),
    _f("Bambu Lab", "PLA Basic Blue",             "#0A2989", 1.0),
    _f("Bambu Lab", "PLA Basic Purple",           "#5E43B7", 1.1),
    _f("Bambu Lab", "PLA Basic Brown",            "#9D432C", 1.0),
    _f("Bambu Lab", "PLA Basic Beige",            "#F7E6DE", 3.4),
    _f("Bambu Lab", "PLA Basic Gold",             "#E4BD68", 2.0),
    _f("Bambu Lab", "PLA Basic Turquoise",        "#00B1B7", 1.5),
    _f("Bambu Lab", "PLA Basic Cocoa Brown",      "#6F5034", 0.9),
    _f("Bambu Lab", "PLA Basic Hot Pink",         "#F5547C", 1.6),
    _f("Bambu Lab", "PLA Basic Maroon Red",       "#9D2235", 1.1),
    _f("Bambu Lab", "PLA Basic Mistletoe Green",  "#3F8E43", 1.4),
    _f("Bambu Lab", "PLA Basic Indigo Purple",    "#482960", 0.9),
    _f("Bambu Lab", "PLA Basic Dark Gray",        "#545454", 1.0),
    _f("Bambu Lab", "PLA Matte Ivory White",      "#FFFFFF", 4.2, "matte"),
    _f("Bambu Lab", "PLA Matte Charcoal",         "#1A1A1A", 0.7, "matte"),
    _f("Bambu Lab", "PLA Matte Lemon Yellow",     "#F7D959", 2.0, "matte"),
    _f("Bambu Lab", "PLA Matte Mandarin Orange",  "#F77F2E", 1.5, "matte"),
    _f("Bambu Lab", "PLA Matte Scarlet Red",      "#D8341A", 1.2, "matte"),
    _f("Bambu Lab", "PLA Matte Sakura Pink",      "#F2A3B8", 2.4, "matte"),
    _f("Bambu Lab", "PLA Matte Apple Green",      "#A8C04D", 1.7, "matte"),
    _f("Bambu Lab", "PLA Matte Ice Blue",         "#A6D1E4", 2.8, "matte"),
    _f("Bambu Lab", "PLA Matte Dark Blue",        "#0F2E54", 0.9, "matte"),
    _f("Bambu Lab", "PLA Matte Latte Brown",      "#D3B7A7", 2.8, "matte"),
    _f("Bambu Lab", "PLA Matte Desert Tan",       "#E8DBB7", 3.0, "matte"),
    _f("Bambu Lab", "PLA Matte Lilac Purple",     "#AE96D4", 2.2, "matte"),
    _f("Bambu Lab", "PLA Matte Grass Green",      "#61C680", 1.8, "matte"),
    _f("Bambu Lab", "PLA Matte Marine Blue",      "#0078BF", 1.3, "matte"),
    _f("Bambu Lab", "PLA Matte Terracotta",       "#B15533", 1.2, "matte"),
    _f("Bambu Lab", "PLA Matte Ash Gray",         "#9B9EA0", 1.5, "matte"),
    _f("Bambu Lab", "PLA Matte Nardo Gray",       "#757575", 1.2, "matte"),
    _f("Bambu Lab", "PLA Matte Caramel",          "#AE835B", 1.6, "matte"),
    _f("Bambu Lab", "PLA Silk Gold",              "#E2B53A", 1.9, "silk"),
    _f("Bambu Lab", "PLA Silk Silver",            "#C8CBC8", 1.7, "silk"),
    _f("Bambu Lab", "PLA Silk+ Champagne",        "#F0DDB7", 2.4, "silk"),
    _f("Bambu Lab", "PLA Silk+ Rose Gold",        "#D9A0A4", 2.0, "silk"),
    _f("Bambu Lab", "PLA Silk+ Candy Red",        "#D02727", 1.3, "silk"),
    _f("Bambu Lab", "PLA Silk+ Candy Green",      "#018814", 1.3, "silk"),
    _f("Bambu Lab", "PLA Silk+ Blue",             "#008BDA", 1.4, "silk"),
    _f("Bambu Lab", "PLA Silk+ Purple",           "#854CE4", 1.2, "silk"),
    _petg("Bambu Lab", "PETG HF White",           "#FFFFFF", 6.0),
    _petg("Bambu Lab", "PETG HF Black",           "#000000", 1.0),
    _petg("Bambu Lab", "PETG HF Gray",            "#ADAFAD", 2.4),
    _petg("Bambu Lab", "PETG HF Red",             "#BB3D43", 2.2),
    _petg("Bambu Lab", "PETG HF Orange",          "#FF911A", 2.6),
    _petg("Bambu Lab", "PETG HF Yellow",          "#FFD00F", 3.0),
    _petg("Bambu Lab", "PETG HF Green",           "#00AE42", 2.4),
    _petg("Bambu Lab", "PETG HF Lake Blue",       "#1F79DE", 2.2),
    _petg("Bambu Lab", "PETG HF Dark Blue",       "#073A66", 1.4),
    _petg("Bambu Lab", "PETG HF Cream",           "#F8EFDA", 4.4),
    _petg("Bambu Lab", "PETG HF Peanut Brown",    "#875718", 1.4),
    _petg("Bambu Lab", "PETG Translucent",        "#E8EDEE", 11.0, "transparent"),
]

# ---------------------------------------------------------------------------
# Polymaker — PolyLite (gloss) / PolyTerra (matte) / PolyMax / PETG
# ---------------------------------------------------------------------------
POLYMAKER = [
    _f("Polymaker", "PolyLite PLA White",        "#F4F4F4", 4.6),
    _f("Polymaker", "PolyLite PLA Black",        "#1C1C1C", 0.8),
    _f("Polymaker", "PolyLite PLA Red",          "#CE1F2C", 1.3),
    _f("Polymaker", "PolyLite PLA Yellow",       "#F6CB1C", 1.9),
    _f("Polymaker", "PolyLite PLA Orange",       "#F26A23", 1.4),
    _f("Polymaker", "PolyLite PLA Green",        "#28A745", 1.5),
    _f("Polymaker", "PolyLite PLA Blue",         "#1F4FA5", 1.1),
    _f("Polymaker", "PolyLite PLA Teal",         "#1AAFAA", 1.4),
    _f("Polymaker", "PolyLite PLA Pink",         "#E94B83", 1.7),
    _f("Polymaker", "PolyLite PLA Grey",         "#8C8C8C", 1.4),
    _f("Polymaker", "PolyTerra PLA Cotton White","#EFE9DE", 4.2, "matte"),
    _f("Polymaker", "PolyTerra PLA Charcoal Black","#222222", 0.7, "matte"),
    _f("Polymaker", "PolyTerra PLA Lava Red",    "#B82A2A", 1.2, "matte"),
    _f("Polymaker", "PolyTerra PLA Banana Yellow","#F2D14D", 2.0, "matte"),
    _f("Polymaker", "PolyTerra PLA Sunrise Orange","#F08442", 1.6, "matte"),
    _f("Polymaker", "PolyTerra PLA Forest Green","#2F6A45", 1.2, "matte"),
    _f("Polymaker", "PolyTerra PLA Sapphire Blue","#163A6E", 1.0, "matte"),
    _f("Polymaker", "PolyTerra PLA Lavender Purple","#9C8AC7", 1.9, "matte"),
    _f("Polymaker", "PolyTerra PLA Muted Pink",  "#E6A9B8", 2.6, "matte"),
    _f("Polymaker", "PolyTerra PLA Army Beige",  "#C7B27A", 2.2, "matte"),
    _f("Polymaker", "PolyTerra PLA Fossil Grey", "#8B8E90", 1.4, "matte"),
    _f("Polymaker", "PolyTerra PLA Marble Slate Grey", "#6E7173", 1.2, "matte"),
    _f("Polymaker", "PolyTerra PLA Peach",       "#F4BBA0", 2.6, "matte"),
    _f("Polymaker", "PolyTerra PLA Mint",        "#A9D9C2", 2.6, "matte"),
    _f("Polymaker", "PolyTerra PLA Ice",         "#BDE3E6", 2.9, "matte"),
    _f("Polymaker", "PolyTerra PLA Lime Green",  "#A7CE3D", 1.9, "matte"),
    _f("Polymaker", "PolyTerra PLA Earth Brown", "#5B4336", 0.9, "matte"),
    _f("Polymaker", "PolyTerra PLA Wood Brown",  "#8A5F3C", 1.0, "matte"),
    _f("Polymaker", "PolyTerra PLA Savannah Yellow", "#E0B83C", 2.0, "matte"),
    _f("Polymaker", "PolyTerra PLA Electric Indigo", "#4B3F99", 1.0, "matte"),
    _f("Polymaker", "PolyTerra PLA Arctic Teal", "#3FA8A4", 1.6, "matte"),
    _f("Polymaker", "PolyTerra PLA Rose",        "#D96C84", 1.8, "matte"),
    _f("Polymaker", "PolyMax PLA True White",    "#FAFAFA", 4.8),
    _f("Polymaker", "PolyMax PLA Jet Black",     "#0B0B0B", 0.7),
    _petg("Polymaker", "PolyLite PETG White",    "#F5F5F5", 6.0),
    _petg("Polymaker", "PolyLite PETG Black",    "#161616", 1.0),
    _petg("Polymaker", "PolyLite PETG Red",      "#C42430", 2.2),
    _petg("Polymaker", "PolyLite PETG Yellow",   "#F1C40F", 3.0),
    _petg("Polymaker", "PolyLite PETG Orange",   "#EE7321", 2.5),
    _petg("Polymaker", "PolyLite PETG Green",    "#2E9E4D", 2.3),
    _petg("Polymaker", "PolyLite PETG Blue",     "#1E5BA8", 2.0),
    _petg("Polymaker", "PolyLite PETG Grey",     "#898E92", 2.2),
    _petg("Polymaker", "PolyLite PETG Transparent", "#E9EFF0", 12.0, "transparent"),
]

# ---------------------------------------------------------------------------
# Prusament — Prusa Research curated PLA + PETG SKUs
# ---------------------------------------------------------------------------
PRUSAMENT = [
    _f("Prusament", "PLA Vanilla White",         "#F1ECDF", 4.6),
    _f("Prusament", "PLA Galaxy Black",          "#0A0A0A", 0.7),
    _f("Prusament", "PLA Lipstick Red",          "#B12E36", 1.3),
    _f("Prusament", "PLA Prusa Orange",          "#FA6831", 1.5),
    _f("Prusament", "PLA Yellow",                "#F8C520", 1.9),
    _f("Prusament", "PLA Pineapple Yellow",      "#F4D34E", 2.1),
    _f("Prusament", "PLA Pearl Mouse",           "#9CA09F", 1.5),
    _f("Prusament", "PLA Royal Blue",            "#1A3FA0", 1.0),
    _f("Prusament", "PLA Azure Blue",            "#1F71BB", 1.2),
    _f("Prusament", "PLA Mystic Green",          "#345F40", 1.2),
    _f("Prusament", "PLA Pistachio Green",       "#A6C45B", 1.7),
    _f("Prusament", "PLA Diamond Black",         "#181818", 0.8),
    _f("Prusament", "PLA Lila Cloud Pink",       "#D8AED5", 2.5),
    _f("Prusament", "PLA Opal Green",            "#7DB098", 2.0),
    _f("Prusament", "PLA Jet Black",             "#111111", 0.7),
    _f("Prusament", "PLA Gravity Grey",          "#65696B", 1.1),
    _f("Prusament", "PLA Ms. Pink",              "#E84B8A", 1.6),
    _f("Prusament", "PLA Simply Green",          "#27A343", 1.5),
    _f("Prusament", "PLA Viva La Bronze",        "#9C6B3C", 1.2),
    _f("Prusament", "PLA Oh My Gold",            "#C9A33B", 1.9, "silk"),
    _petg("Prusament", "PETG Signal White",      "#F2F1EC", 5.8),
    _petg("Prusament", "PETG Jet Black",         "#111111", 1.0),
    _petg("Prusament", "PETG Prusa Orange",      "#F75403", 2.5),
    _petg("Prusament", "PETG Yellow Gold",       "#E7B24B", 2.8),
    _petg("Prusament", "PETG Carmine Red",       "#A41C28", 2.0),
    _petg("Prusament", "PETG Ultramarine Blue",  "#2B3A8F", 1.8),
    _petg("Prusament", "PETG Jungle Green",      "#1F6A41", 2.0),
    _petg("Prusament", "PETG Urban Grey",        "#7C8084", 2.2),
    _petg("Prusament", "PETG Chalky Blue",       "#7593AE", 2.6),
    _petg("Prusament", "PETG Clear",             "#EDF2F2", 12.5, "transparent"),
]

# ---------------------------------------------------------------------------
# eSun — PLA+ gloss line, matte PLA-Matte, PETG
# ---------------------------------------------------------------------------
ESUN = [
    _f("eSun", "PLA+ Cold White",                "#F2F2F2", 4.4),
    _f("eSun", "PLA+ Solid Black",               "#0C0C0C", 0.7),
    _f("eSun", "PLA+ Fire Engine Red",           "#D3211C", 1.3),
    _f("eSun", "PLA+ Orange",                    "#F4791F", 1.5),
    _f("eSun", "PLA+ Yellow",                    "#F8CB14", 1.9),
    _f("eSun", "PLA+ Light Blue",                "#67B3DF", 2.3),
    _f("eSun", "PLA+ Dark Blue",                 "#103A8A", 1.0),
    _f("eSun", "PLA+ Pink",                      "#E97AA0", 1.8),
    _f("eSun", "PLA+ Apple Green",               "#69B946", 1.6),
    _f("eSun", "PLA+ Olive Green",               "#6A7D34", 1.2),
    _f("eSun", "PLA+ Grey",                      "#888B8E", 1.4),
    _f("eSun", "PLA+ Brown",                     "#7A4329", 0.9),
    _f("eSun", "PLA+ Purple",                    "#6A3FA0", 1.1),
    _f("eSun", "PLA+ Magenta",                   "#D5258F", 1.4),
    _f("eSun", "PLA-Matte Almond Yellow",        "#F1DA94", 2.4, "matte"),
    _f("eSun", "PLA-Matte Mint Green",           "#9BD6B7", 2.6, "matte"),
    _f("eSun", "PLA-Matte Coral Red",            "#D34B49", 1.5, "matte"),
    _f("eSun", "PLA-Matte Milky White",          "#F2EEE3", 4.0, "matte"),
    _f("eSun", "PLA-Matte Deep Black",           "#141414", 0.7, "matte"),
    _petg("eSun", "PETG Solid White",            "#F3F3F3", 5.8),
    _petg("eSun", "PETG Solid Black",            "#0E0E0E", 1.0),
    _petg("eSun", "PETG Solid Red",              "#C52127", 2.2),
    _petg("eSun", "PETG Solid Orange",           "#EE7623", 2.5),
    _petg("eSun", "PETG Solid Yellow",           "#F2C522", 2.9),
    _petg("eSun", "PETG Solid Green",            "#2D9A47", 2.3),
    _petg("eSun", "PETG Solid Blue",             "#1C4F9C", 1.9),
    _petg("eSun", "PETG Solid Grey",             "#85888B", 2.2),
    _petg("eSun", "PETG Transparent",            "#E6EDED", 11.5, "transparent"),
]

# ---------------------------------------------------------------------------
# Sunlu — PLA+ value brand, matte, silk, PETG
# ---------------------------------------------------------------------------
SUNLU = [
    _f("Sunlu", "PLA+ White",                    "#F4F4F4", 4.5),
    _f("Sunlu", "PLA+ Black",                    "#0E0E0E", 0.8),
    _f("Sunlu", "PLA+ Red",                      "#CC1B26", 1.3),
    _f("Sunlu", "PLA+ Orange",                   "#F47120", 1.5),
    _f("Sunlu", "PLA+ Yellow",                   "#F4C913", 1.9),
    _f("Sunlu", "PLA+ Green",                    "#3CB14D", 1.5),
    _f("Sunlu", "PLA+ Blue",                     "#1F4DA8", 1.1),
    _f("Sunlu", "PLA+ Purple",                   "#603DA7", 1.1),
    _f("Sunlu", "PLA+ Grey",                     "#8B8C8E", 1.4),
    _f("Sunlu", "PLA+ Transparent",              "#E0EAEA", 9.5, "transparent"),
    _f("Sunlu", "PLA+ Sky Blue",                 "#56A8DC", 1.9),
    _f("Sunlu", "PLA+ Pink",                     "#EE7FA4", 1.8),
    _f("Sunlu", "PLA+ Brown",                    "#73452B", 0.9),
    _f("Sunlu", "PLA+ Beige Skin",               "#F0CBA8", 3.0),
    _f("Sunlu", "PLA Matte Light Grey",          "#BFC1BE", 2.0, "matte"),
    _f("Sunlu", "PLA Matte Sand Yellow",         "#E6C77A", 2.4, "matte"),
    _f("Sunlu", "Silk PLA Gold",                 "#D6B33B", 2.0, "silk"),
    _f("Sunlu", "Silk PLA Copper",               "#B97A47", 1.5, "silk"),
    _petg("Sunlu", "PETG White",                 "#F2F2F2", 5.6),
    _petg("Sunlu", "PETG Black",                 "#101010", 1.0),
    _petg("Sunlu", "PETG Red",                   "#C7212B", 2.2),
    _petg("Sunlu", "PETG Yellow",                "#F1C71C", 2.8),
    _petg("Sunlu", "PETG Green",                 "#33A04A", 2.3),
    _petg("Sunlu", "PETG Blue",                  "#1E4FA3", 1.9),
    _petg("Sunlu", "PETG Transparent",           "#E5EDED", 11.5, "transparent"),
]

# ---------------------------------------------------------------------------
# Overture — PLA / PLA Matte / PETG
# ---------------------------------------------------------------------------
OVERTURE = [
    _f("Overture", "PLA White",                  "#F0F0F0", 4.4),
    _f("Overture", "PLA Black",                  "#0D0D0D", 0.7),
    _f("Overture", "PLA Red",                    "#C6212A", 1.3),
    _f("Overture", "PLA Orange",                 "#F36E1B", 1.5),
    _f("Overture", "PLA Yellow",                 "#F2C81F", 1.9),
    _f("Overture", "PLA Green",                  "#2EAC4A", 1.5),
    _f("Overture", "PLA Sky Blue",               "#3BA3DB", 1.7),
    _f("Overture", "PLA Navy Blue",              "#11366E", 0.9),
    _f("Overture", "PLA Beige",                  "#D6C3A0", 3.0),
    _f("Overture", "PLA Pink",                   "#E97AA1", 1.8),
    _f("Overture", "PLA Purple",                 "#5F3D9C", 1.1),
    _f("Overture", "PLA Space Gray",             "#6E7072", 1.2),
    _f("Overture", "Matte PLA Charcoal",         "#1C1C1C", 0.7, "matte"),
    _f("Overture", "Matte PLA Smoke White",      "#E9E6DE", 4.0, "matte"),
    _f("Overture", "Matte PLA Pumpkin Orange",   "#E16826", 1.4, "matte"),
    _f("Overture", "Matte PLA Olive Drab",       "#6A6B3B", 1.0, "matte"),
    _petg("Overture", "PETG White",              "#F1F1F1", 5.8),
    _petg("Overture", "PETG Black",              "#0F0F0F", 1.0),
    _petg("Overture", "PETG Red",                "#C32630", 2.2),
    _petg("Overture", "PETG Orange",             "#EF7222", 2.5),
    _petg("Overture", "PETG Yellow",             "#F0C829", 2.9),
    _petg("Overture", "PETG Green",              "#2C9C4B", 2.3),
    _petg("Overture", "PETG Blue",               "#1D55A4", 1.9),
    _petg("Overture", "PETG Transparent",        "#E8EEEE", 12.0, "transparent"),
]

# ---------------------------------------------------------------------------
# Hatchbox — staple gloss PLA + PETG
# ---------------------------------------------------------------------------
HATCHBOX = [
    _f("Hatchbox", "PLA True White",             "#F4F4F4", 4.5),
    _f("Hatchbox", "PLA True Black",             "#0E0E0E", 0.7),
    _f("Hatchbox", "PLA True Red",               "#CD1F26", 1.3),
    _f("Hatchbox", "PLA Orange",                 "#F4751E", 1.5),
    _f("Hatchbox", "PLA Yellow",                 "#F1C512", 1.9),
    _f("Hatchbox", "PLA Green",                  "#2FAD46", 1.5),
    _f("Hatchbox", "PLA Blue",                   "#1E4FA9", 1.0),
    _f("Hatchbox", "PLA Silver",                 "#B5B7B8", 1.6),
    _f("Hatchbox", "PLA Brown",                  "#5C2F1A", 0.9),
    _f("Hatchbox", "PLA Transparent",            "#DAE7E7", 10.0, "transparent"),
    _f("Hatchbox", "PLA Cool Gray",              "#9DA2A6", 1.5),
    _f("Hatchbox", "PLA Pink",                   "#EC78A2", 1.8),
    _f("Hatchbox", "PLA Purple",                 "#5A3D9E", 1.1),
    _f("Hatchbox", "PLA Light Blue",             "#6CB6E2", 2.2),
    _f("Hatchbox", "PLA Mint Green",             "#9ED9BC", 2.6),
    _f("Hatchbox", "PLA Gold",                   "#CFA34A", 1.9),
    _petg("Hatchbox", "PETG White",              "#F2F2F2", 5.7),
    _petg("Hatchbox", "PETG Black",              "#101010", 1.0),
    _petg("Hatchbox", "PETG Red",                "#C42129", 2.2),
    _petg("Hatchbox", "PETG Yellow",             "#F0C61E", 2.8),
    _petg("Hatchbox", "PETG Green",              "#2F9E49", 2.3),
    _petg("Hatchbox", "PETG Blue",               "#1E51A6", 1.9),
    _petg("Hatchbox", "PETG Gray",               "#888B8E", 2.2),
    _petg("Hatchbox", "PETG Transparent",        "#E7EDED", 11.5, "transparent"),
]

# ---------------------------------------------------------------------------
# uJoybio3d — color-rich budget brand
# ---------------------------------------------------------------------------
UJOYBIO3D = [
    _f("uJoybio3d", "PLA Pure White",            "#F6F6F6", 4.6),
    _f("uJoybio3d", "PLA Jet Black",             "#0B0B0B", 0.7),
    _f("uJoybio3d", "PLA Bright Red",            "#CC1F24", 1.3),
    _f("uJoybio3d", "PLA Lemon Yellow",          "#F0D33A", 2.0),
    _f("uJoybio3d", "PLA Sky Blue",              "#5DB1DD", 1.9),
    _f("uJoybio3d", "PLA Grass Green",           "#52B14B", 1.5),
    _f("uJoybio3d", "PLA Coral Pink",            "#F08B95", 2.1),
    _f("uJoybio3d", "PLA Royal Purple",          "#683AAF", 1.0),
    _f("uJoybio3d", "PLA Tangerine",             "#F47A30", 1.5),
    _f("uJoybio3d", "PLA Pearl Grey",            "#B6B6B5", 1.6),
]

# ---------------------------------------------------------------------------
# FlashForge — PLA / PLA Pro / PETG Pro
# ---------------------------------------------------------------------------
FLASHFORGE = [
    _f("FlashForge", "PLA White",                "#F2F2F2", 4.4),
    _f("FlashForge", "PLA Black",                "#0E0E0E", 0.8),
    _f("FlashForge", "PLA Red",                  "#C92129", 1.3),
    _f("FlashForge", "PLA Orange",               "#F47422", 1.5),
    _f("FlashForge", "PLA Yellow",               "#F3CA1A", 1.9),
    _f("FlashForge", "PLA Green",                "#3FAE44", 1.5),
    _f("FlashForge", "PLA Blue",                 "#1F4FA0", 1.0),
    _f("FlashForge", "PLA Pink",                 "#EC7AA0", 1.8),
    _f("FlashForge", "PLA Pro Cool White",       "#FAFAFA", 4.8),
    _f("FlashForge", "PLA Pro Carbon Black",     "#0A0A0A", 0.7),
    _f("FlashForge", "PLA Pro Skin",             "#F0C9A8", 3.0),
    _petg("FlashForge", "PETG Pro White",        "#F3F3F3", 5.8),
    _petg("FlashForge", "PETG Pro Black",        "#0F0F0F", 1.0),
    _petg("FlashForge", "PETG Pro Red",          "#C5232B", 2.2),
    _petg("FlashForge", "PETG Pro Blue",         "#1E52A2", 1.9),
]

# ---------------------------------------------------------------------------
# Elegoo — PLA / PLA Matte / Rapid PETG
# ---------------------------------------------------------------------------
ELEGOO = [
    _f("Elegoo", "PLA White",                    "#F4F4F4", 4.5),
    _f("Elegoo", "PLA Black",                    "#0D0D0D", 0.7),
    _f("Elegoo", "PLA Red",                      "#C82530", 1.3),
    _f("Elegoo", "PLA Orange",                   "#F2731F", 1.5),
    _f("Elegoo", "PLA Yellow",                   "#F3CB1C", 1.9),
    _f("Elegoo", "PLA Green",                    "#2FA84A", 1.5),
    _f("Elegoo", "PLA Blue",                     "#1C4E9E", 1.0),
    _f("Elegoo", "PLA Sky Blue",                 "#54AEDC", 1.9),
    _f("Elegoo", "PLA Purple",                   "#5F3CA4", 1.1),
    _f("Elegoo", "PLA Pink",                     "#EE7DA4", 1.8),
    _f("Elegoo", "PLA Grey",                     "#8A8D90", 1.4),
    _f("Elegoo", "PLA Silver",                   "#B2B5B6", 1.6),
    _f("Elegoo", "PLA Brown",                    "#74462B", 0.9),
    _f("Elegoo", "PLA Beige",                    "#E8D4AE", 3.0),
    _f("Elegoo", "PLA Matte White",              "#EFECE4", 4.0, "matte"),
    _f("Elegoo", "PLA Matte Black",              "#161616", 0.7, "matte"),
    _f("Elegoo", "PLA Matte Sakura Pink",        "#F0A8BC", 2.4, "matte"),
    _f("Elegoo", "PLA Matte Mint Green",         "#A2D8BE", 2.6, "matte"),
    _petg("Elegoo", "Rapid PETG White",          "#F2F2F2", 5.8),
    _petg("Elegoo", "Rapid PETG Black",          "#0F0F0F", 1.0),
    _petg("Elegoo", "Rapid PETG Red",            "#C52630", 2.2),
    _petg("Elegoo", "Rapid PETG Orange",         "#EE7424", 2.5),
    _petg("Elegoo", "Rapid PETG Yellow",         "#F0C824", 2.9),
    _petg("Elegoo", "Rapid PETG Green",          "#2C9B4A", 2.3),
    _petg("Elegoo", "Rapid PETG Blue",           "#1D52A2", 1.9),
    _petg("Elegoo", "Rapid PETG Grey",           "#86898C", 2.2),
    _petg("Elegoo", "Rapid PETG Translucent",    "#E7EEEE", 11.5, "transparent"),
]

# ---------------------------------------------------------------------------
# Creality — Hyper PLA / Ender-PLA / CR-PETG
# ---------------------------------------------------------------------------
CREALITY = [
    _f("Creality", "Hyper PLA White",            "#F5F5F5", 4.6),
    _f("Creality", "Hyper PLA Black",            "#0C0C0C", 0.7),
    _f("Creality", "Hyper PLA Red",              "#CA222B", 1.3),
    _f("Creality", "Hyper PLA Orange",           "#F37320", 1.5),
    _f("Creality", "Hyper PLA Yellow",           "#F3C918", 1.9),
    _f("Creality", "Hyper PLA Green",            "#2FA94B", 1.5),
    _f("Creality", "Hyper PLA Blue",             "#1D4FA1", 1.0),
    _f("Creality", "Hyper PLA Grey",             "#898C8F", 1.4),
    _f("Creality", "Hyper PLA Pink",             "#EE7CA3", 1.8),
    _f("Creality", "Hyper PLA Purple",           "#5E3BA5", 1.1),
    _f("Creality", "Hyper PLA Skin",             "#F1CBAA", 3.0),
    _f("Creality", "Hyper PLA Silver",           "#B3B6B7", 1.6),
    _f("Creality", "Ender-PLA White",            "#F3F3F3", 4.4),
    _f("Creality", "Ender-PLA Black",            "#0E0E0E", 0.8),
    _f("Creality", "Ender-PLA Red",              "#C7242C", 1.3),
    _f("Creality", "Ender-PLA Yellow",           "#F2C71E", 1.9),
    _f("Creality", "Ender-PLA Green",            "#30A64B", 1.5),
    _f("Creality", "Ender-PLA Blue",             "#1E4F9F", 1.0),
    _f("Creality", "Ender-PLA Grey",             "#8B8E91", 1.4),
    _f("Creality", "Ender-PLA Transparent",      "#E2EAEA", 9.5, "transparent"),
    _petg("Creality", "CR-PETG White",           "#F2F2F2", 5.7),
    _petg("Creality", "CR-PETG Black",           "#101010", 1.0),
    _petg("Creality", "CR-PETG Red",             "#C5242C", 2.2),
    _petg("Creality", "CR-PETG Yellow",          "#F0C722", 2.8),
    _petg("Creality", "CR-PETG Green",           "#2E9C4A", 2.3),
    _petg("Creality", "CR-PETG Blue",            "#1E51A3", 1.9),
    _petg("Creality", "CR-PETG Transparent",     "#E6EDED", 11.5, "transparent"),
]

# ---------------------------------------------------------------------------
# Anycubic — PLA / PLA Matte / PETG
# ---------------------------------------------------------------------------
ANYCUBIC = [
    _f("Anycubic", "PLA White",                  "#F4F4F4", 4.5),
    _f("Anycubic", "PLA Black",                  "#0D0D0D", 0.7),
    _f("Anycubic", "PLA Red",                    "#C9232C", 1.3),
    _f("Anycubic", "PLA Orange",                 "#F37521", 1.5),
    _f("Anycubic", "PLA Yellow",                 "#F2C81B", 1.9),
    _f("Anycubic", "PLA Green",                  "#2FA74B", 1.5),
    _f("Anycubic", "PLA Blue",                   "#1D4FA0", 1.0),
    _f("Anycubic", "PLA Sky Blue",               "#56ADDC", 1.9),
    _f("Anycubic", "PLA Purple",                 "#5F3CA3", 1.1),
    _f("Anycubic", "PLA Pink",                   "#ED7CA2", 1.8),
    _f("Anycubic", "PLA Grey",                   "#8A8D90", 1.4),
    _f("Anycubic", "PLA Brown",                  "#75462C", 0.9),
    _f("Anycubic", "PLA Matte White",            "#EFEDE5", 4.0, "matte"),
    _f("Anycubic", "PLA Matte Black",            "#171717", 0.7, "matte"),
    _petg("Anycubic", "PETG White",              "#F2F2F2", 5.7),
    _petg("Anycubic", "PETG Black",              "#0F0F0F", 1.0),
    _petg("Anycubic", "PETG Red",                "#C5242D", 2.2),
    _petg("Anycubic", "PETG Blue",               "#1E51A2", 1.9),
    _petg("Anycubic", "PETG Green",              "#2E9B49", 2.3),
    _petg("Anycubic", "PETG Transparent",        "#E7EEEE", 11.5, "transparent"),
]

# ---------------------------------------------------------------------------
# Eryone — PLA / Matte PLA
# ---------------------------------------------------------------------------
ERYONE = [
    _f("Eryone", "PLA White",                    "#F4F4F4", 4.5),
    _f("Eryone", "PLA Black",                    "#0E0E0E", 0.7),
    _f("Eryone", "PLA Red",                      "#C8232C", 1.3),
    _f("Eryone", "PLA Orange",                   "#F37522", 1.5),
    _f("Eryone", "PLA Yellow",                   "#F2C91D", 1.9),
    _f("Eryone", "PLA Green",                    "#2FA84B", 1.5),
    _f("Eryone", "PLA Blue",                     "#1D50A1", 1.0),
    _f("Eryone", "PLA Purple",                   "#5E3BA4", 1.1),
    _f("Eryone", "PLA Grey",                     "#8A8D90", 1.4),
    _f("Eryone", "Matte PLA Milky White",        "#F0EDE4", 4.0, "matte"),
    _f("Eryone", "Matte PLA Black",              "#161616", 0.7, "matte"),
    _f("Eryone", "Matte PLA Lime Green",         "#A6CC42", 1.9, "matte"),
]

# ---------------------------------------------------------------------------
# Inland (Micro Center) — PLA / PETG value lines
# ---------------------------------------------------------------------------
INLAND = [
    _f("Inland", "PLA White",                    "#F3F3F3", 4.4),
    _f("Inland", "PLA Black",                    "#0E0E0E", 0.7),
    _f("Inland", "PLA Red",                      "#C7232C", 1.3),
    _f("Inland", "PLA Orange",                   "#F37423", 1.5),
    _f("Inland", "PLA Yellow",                   "#F1C71F", 1.9),
    _f("Inland", "PLA Green",                    "#2FA64B", 1.5),
    _f("Inland", "PLA Blue",                     "#1E4F9F", 1.0),
    _f("Inland", "PLA Light Blue",               "#69B5E1", 2.2),
    _f("Inland", "PLA Purple",                   "#5E3CA3", 1.1),
    _f("Inland", "PLA Pink",                     "#ED7BA2", 1.8),
    _f("Inland", "PLA Gray",                     "#8B8E91", 1.4),
    _f("Inland", "PLA Brown",                    "#74452B", 0.9),
    _petg("Inland", "PETG White",                "#F2F2F2", 5.6),
    _petg("Inland", "PETG Black",                "#101010", 1.0),
    _petg("Inland", "PETG Red",                  "#C4242C", 2.2),
    _petg("Inland", "PETG Yellow",               "#F0C723", 2.8),
    _petg("Inland", "PETG Green",                "#2E9B4A", 2.3),
    _petg("Inland", "PETG Blue",                 "#1E50A2", 1.9),
    _petg("Inland", "PETG Gray",                 "#87898C", 2.2),
    _petg("Inland", "PETG Translucent",          "#E7EDED", 11.0, "transparent"),
]

# ---------------------------------------------------------------------------
# JAYO — budget PLA (Sunlu sister brand)
# ---------------------------------------------------------------------------
JAYO = [
    _f("JAYO", "PLA White",                      "#F4F4F4", 4.5),
    _f("JAYO", "PLA Black",                      "#0E0E0E", 0.8),
    _f("JAYO", "PLA Red",                        "#CB1F27", 1.3),
    _f("JAYO", "PLA Orange",                     "#F47221", 1.5),
    _f("JAYO", "PLA Yellow",                     "#F3C915", 1.9),
    _f("JAYO", "PLA Green",                      "#3BB04C", 1.5),
    _f("JAYO", "PLA Blue",                       "#1F4DA6", 1.1),
    _f("JAYO", "PLA Sky Blue",                   "#57A9DC", 1.9),
    _f("JAYO", "PLA Pink",                       "#EE7EA3", 1.8),
    _f("JAYO", "PLA Grey",                       "#8B8C8E", 1.4),
]

# ---------------------------------------------------------------------------
# Duramic 3D — PLA Plus
# ---------------------------------------------------------------------------
DURAMIC = [
    _f("Duramic 3D", "PLA Plus White",           "#F3F3F3", 4.4),
    _f("Duramic 3D", "PLA Plus Black",           "#0E0E0E", 0.8),
    _f("Duramic 3D", "PLA Plus Red",             "#C8222B", 1.3),
    _f("Duramic 3D", "PLA Plus Orange",          "#F37322", 1.5),
    _f("Duramic 3D", "PLA Plus Yellow",          "#F2C81D", 1.9),
    _f("Duramic 3D", "PLA Plus Green",           "#2FA74A", 1.5),
    _f("Duramic 3D", "PLA Plus Blue",            "#1D4FA0", 1.0),
    _f("Duramic 3D", "PLA Plus Grey",            "#8A8D90", 1.4),
    _f("Duramic 3D", "PLA Plus Brown",           "#75462B", 0.9),
    _f("Duramic 3D", "PLA Plus Skin",            "#F0CAA9", 3.0),
]

# ---------------------------------------------------------------------------
# Atomic Filament — premium US-made PLA
# ---------------------------------------------------------------------------
ATOMIC = [
    _f("Atomic Filament", "PLA Bright White",    "#F7F7F7", 4.7),
    _f("Atomic Filament", "PLA Deep Black",      "#0B0B0B", 0.7),
    _f("Atomic Filament", "PLA Cherry Red",      "#BE1E2D", 1.3),
    _f("Atomic Filament", "PLA Construction Orange", "#F05A22", 1.4),
    _f("Atomic Filament", "PLA School Bus Yellow", "#F5BD1F", 2.0),
    _f("Atomic Filament", "PLA Kelly Green",     "#2C9A47", 1.5),
    _f("Atomic Filament", "PLA Sapphire Blue",   "#16458F", 1.0),
    _f("Atomic Filament", "PLA Light Gray",      "#AEB1B3", 1.6),
]

# ---------------------------------------------------------------------------
# Geeetech — budget PLA
# ---------------------------------------------------------------------------
GEEETECH = [
    _f("Geeetech", "PLA White",                  "#F3F3F3", 4.4),
    _f("Geeetech", "PLA Black",                  "#0E0E0E", 0.8),
    _f("Geeetech", "PLA Red",                    "#C9232C", 1.3),
    _f("Geeetech", "PLA Yellow",                 "#F2C81E", 1.9),
    _f("Geeetech", "PLA Green",                  "#2FA64A", 1.5),
    _f("Geeetech", "PLA Blue",                   "#1E4FA0", 1.0),
    _f("Geeetech", "PLA Purple",                 "#5E3CA2", 1.1),
    _f("Geeetech", "PLA Silver",                 "#B3B5B6", 1.6),
]

# ---------------------------------------------------------------------------
# Amazon Basics — staple PLA
# ---------------------------------------------------------------------------
AMAZON_BASICS = [
    _f("Amazon Basics", "PLA White",             "#F3F3F3", 4.4),
    _f("Amazon Basics", "PLA Black",             "#0E0E0E", 0.8),
    _f("Amazon Basics", "PLA Red",               "#C8232C", 1.3),
    _f("Amazon Basics", "PLA Orange",            "#F37422", 1.5),
    _f("Amazon Basics", "PLA Yellow",            "#F2C81E", 1.9),
    _f("Amazon Basics", "PLA Green",             "#2FA74B", 1.5),
    _f("Amazon Basics", "PLA Blue",              "#1E4FA0", 1.0),
    _f("Amazon Basics", "PLA Gray",              "#8B8E91", 1.4),
]


CATALOG: List[CatalogFilament] = (
    BAMBU + POLYMAKER + PRUSAMENT + ESUN + SUNLU
    + OVERTURE + HATCHBOX + UJOYBIO3D + FLASHFORGE
    + ELEGOO + CREALITY + ANYCUBIC + ERYONE + INLAND
    + JAYO + DURAMIC + ATOMIC + GEEETECH + AMAZON_BASICS
)

MATERIALS: List[str] = ["PLA", "PETG"]


def brands() -> List[str]:
    seen: List[str] = []
    for f in CATALOG:
        if f.brand not in seen:
            seen.append(f.brand)
    return seen


def by_id(filament_id: str) -> CatalogFilament | None:
    for f in CATALOG:
        if f.id == filament_id:
            return f
    return None

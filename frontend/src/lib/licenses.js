// Open-source license catalog for shared designs and components.
// Mirrors the MakerWorld / Printables / Thingiverse license menus so users
// can choose terms they already understand. `id` is what gets stored on the
// backend; `short` is shown on cards; `url` deep-links to the canonical text.
export const LICENSES = [
  {
    id: "cc-by-4.0",
    short: "CC BY 4.0",
    name: "Creative Commons — Attribution",
    summary: "Anyone may use, remix, and redistribute — even commercially — as long as they credit you.",
    url: "https://creativecommons.org/licenses/by/4.0/",
    tint: "emerald",
  },
  {
    id: "cc-by-sa-4.0",
    short: "CC BY-SA 4.0",
    name: "Creative Commons — Attribution · ShareAlike",
    summary: "Anyone may remix and redistribute (commercially too), as long as they credit you AND release their version under the same license.",
    url: "https://creativecommons.org/licenses/by-sa/4.0/",
    tint: "emerald",
  },
  {
    id: "cc-by-nc-4.0",
    short: "CC BY-NC 4.0",
    name: "Creative Commons — Attribution · Non-Commercial",
    summary: "Anyone may use and remix for non-commercial purposes with attribution. No selling.",
    url: "https://creativecommons.org/licenses/by-nc/4.0/",
    tint: "amber",
  },
  {
    id: "cc-by-nc-sa-4.0",
    short: "CC BY-NC-SA 4.0",
    name: "Creative Commons — Attribution · Non-Commercial · ShareAlike",
    summary: "Non-commercial remixing only; remixes must use the same license.",
    url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    tint: "amber",
  },
  {
    id: "cc-by-nd-4.0",
    short: "CC BY-ND 4.0",
    name: "Creative Commons — Attribution · No Derivatives",
    summary: "Redistribution allowed (commercially too) but no remixes.",
    url: "https://creativecommons.org/licenses/by-nd/4.0/",
    tint: "amber",
  },
  {
    id: "cc0-1.0",
    short: "CC0 1.0",
    name: "Creative Commons — Public Domain Dedication",
    summary: "No rights reserved. Anyone may do anything with this design.",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    tint: "cyan",
  },
  {
    id: "gpl-3.0",
    short: "GPL v3",
    name: "GNU General Public License v3",
    summary: "Strong copyleft: anyone may use/modify/distribute, but derivative works must also be GPL v3.",
    url: "https://www.gnu.org/licenses/gpl-3.0.html",
    tint: "emerald",
  },
  {
    id: "lgpl-3.0",
    short: "LGPL v3",
    name: "GNU Lesser General Public License v3",
    summary: "Weaker copyleft variant of GPL v3 — typically used for libraries/components combined into larger works.",
    url: "https://www.gnu.org/licenses/lgpl-3.0.html",
    tint: "emerald",
  },
  {
    id: "agpl-3.0",
    short: "AGPL v3",
    name: "GNU Affero General Public License v3",
    summary: "GPL v3 with an additional network-use clause — if you run a modified version as a network service, you must share the source.",
    url: "https://www.gnu.org/licenses/agpl-3.0.html",
    tint: "emerald",
  },
  {
    id: "mit",
    short: "MIT",
    name: "MIT License",
    summary: "Very permissive: anyone may do anything as long as they keep the copyright + license notice.",
    url: "https://opensource.org/license/mit",
    tint: "cyan",
  },
  {
    id: "apache-2.0",
    short: "Apache 2.0",
    name: "Apache License 2.0",
    summary: "Permissive with an explicit patent grant. Good default for industrial / commercial-friendly designs.",
    url: "https://www.apache.org/licenses/LICENSE-2.0",
    tint: "cyan",
  },
  {
    id: "standard-digital",
    short: "Standard Digital",
    name: "ForgeSlicer Standard Digital File License",
    summary: "Personal use & remixing on ForgeSlicer only. No commercial use, no redistribution outside ForgeSlicer without permission.",
    url: "",
    tint: "slate",
  },
];

export const DEFAULT_LICENSE_ID = "cc-by-4.0";

// Lookup helper — returns the catalog entry or a synthetic "unknown" record so
// older items without a license field still render something on cards.
export function getLicense(id) {
  if (!id) return null;
  return LICENSES.find((l) => l.id === id) || {
    id, short: id, name: id, summary: "", url: "", tint: "slate",
  };
}

// Unit system helpers — convert mm ↔ inch for display + input.
//
// Single source of truth for the workspace's unit toggle. Storage is
// ALWAYS in millimetres (Three.js scene math + every store dim);
// inches only exist at the UI layer for users who think imperial.
//
// Why mm-everywhere internally? Because Manifold-3D, OrcaSlicer 3MF,
// the build-volume + nozzle dims, and every existing primitive
// definition are mm. Mixing units in storage would mean tracking
// "what unit is this?" on every field — a maintenance nightmare.

export const MM_PER_IN = 25.4;

/** Convert a length stored in mm to the user's display unit. */
export function toDisplayLen(mm, system = "mm") {
    if (!Number.isFinite(mm)) return 0;
    return system === "in" ? mm / MM_PER_IN : mm;
}

/** Convert a length the user typed (in their display unit) back to mm. */
export function fromDisplayLen(displayValue, system = "mm") {
    const n = Number.isFinite(displayValue) ? displayValue : parseFloat(displayValue || "0");
    if (!Number.isFinite(n)) return 0;
    return system === "in" ? n * MM_PER_IN : n;
}

/** Format a length stored in mm for read-only display. mm gets 1
 *  decimal (typical 3D-printing precision), inches get 3 decimals
 *  (because 0.001 in ≈ 0.025 mm, finer than the printer can resolve
 *  but visually expected by US users). */
export function formatLen(mm, system = "mm", { unit = true, decimals = null } = {}) {
    if (!Number.isFinite(mm)) return unit ? `0 ${system}` : "0";
    const dp = decimals != null ? decimals : (system === "in" ? 3 : 1);
    const v = toDisplayLen(mm, system).toFixed(dp);
    return unit ? `${v} ${system}` : v;
}

/** Format a 3-tuple of mm lengths (e.g. position/dims) as "x × y × z" */
export function formatLen3(mmArray, system = "mm", { unit = true } = {}) {
    if (!Array.isArray(mmArray) || mmArray.length !== 3) return "";
    const dp = system === "in" ? 3 : 1;
    const parts = mmArray.map((m) => toDisplayLen(m, system).toFixed(dp));
    return unit ? `${parts.join(" × ")} ${system}` : parts.join(" × ");
}

/** Display label for the unit system. */
export const unitLabel = (system) => (system === "in" ? "in" : "mm");

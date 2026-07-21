/**
 * clearanceProfile — Printer-Aware Clearance Auto-Tune (iter-151.7).
 *
 * Turns the user's printer profile (nozzle Ø + XY shrink) into a single
 * suggested per-side clearance value that the parametric generators
 * (Box Designer, Drawer Chest, future generators) can consume as their
 * initial default. Users can still override the number in each dialog.
 *
 * Heuristic (empirical from print testing on Bambu / Prusa hardware):
 *   suggested = nozzle * 0.5  +  xyShrink
 *
 *   0.2 nozzle, 0.10 shrink → 0.20 mm
 *   0.4 nozzle, 0.15 shrink → 0.35 mm  ← Bambu X1 default (matches Box default)
 *   0.6 nozzle, 0.20 shrink → 0.50 mm
 *   0.8 nozzle, 0.25 shrink → 0.65 mm
 *
 * Called with the raw profile object; returns a number in mm, clamped to
 * the [0.10, 0.90] range so extreme profiles can't yield unprintable
 * negatives or huge sloppy gaps.
 */
export function getSuggestedClearance(profile) {
  const nozzle = Number.isFinite(profile?.nozzleDiameter) ? profile.nozzleDiameter : 0.4;
  const shrink = Number.isFinite(profile?.xyShrink) ? profile.xyShrink : 0.15;
  const raw = nozzle * 0.5 + shrink;
  const clamped = Math.max(0.1, Math.min(0.9, raw));
  // Snap to nearest 0.05 mm so the number reads cleanly in the UI.
  return Math.round(clamped * 20) / 20;
}

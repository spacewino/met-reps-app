/**
 * Generalized RTS-style percentage of 1RM lookup table and pure mathematical utilities.
 * 
 * Note: This matrix represents a generalized RTS-style powerlifting population starting heuristic,
 * rather than an individually calibrated or definitive physiological 1RM model.
 */

export const DEFAULT_RTS_STYLE_PERCENT_1RM: Record<number, Record<number, number>> = {
  1: { 10.0: 1.000, 9.5: 0.978, 9.0: 0.955, 8.5: 0.939, 8.0: 0.922, 7.5: 0.907, 7.0: 0.892, 6.5: 0.878, 6.0: 0.863 },
  2: { 10.0: 0.955, 9.5: 0.939, 9.0: 0.922, 8.5: 0.907, 8.0: 0.892, 7.5: 0.878, 7.0: 0.863, 6.5: 0.849, 6.0: 0.835 },
  3: { 10.0: 0.922, 9.5: 0.907, 9.0: 0.892, 8.5: 0.878, 8.0: 0.863, 7.5: 0.849, 7.0: 0.835, 6.5: 0.821, 6.0: 0.807 },
  4: { 10.0: 0.892, 9.5: 0.878, 9.0: 0.863, 8.5: 0.849, 8.0: 0.835, 7.5: 0.821, 7.0: 0.807, 6.5: 0.793, 6.0: 0.779 },
  5: { 10.0: 0.863, 9.5: 0.849, 9.0: 0.835, 8.5: 0.821, 8.0: 0.807, 7.5: 0.793, 7.0: 0.779, 6.5: 0.765, 6.0: 0.751 },
  6: { 10.0: 0.835, 9.5: 0.821, 9.0: 0.807, 8.5: 0.793, 8.0: 0.779, 7.5: 0.765, 7.0: 0.751, 6.5: 0.737, 6.0: 0.723 },
  7: { 10.0: 0.807, 9.5: 0.793, 9.0: 0.779, 8.5: 0.765, 8.0: 0.751, 7.5: 0.737, 7.0: 0.723, 6.5: 0.709, 6.0: 0.694 },
  8: { 10.0: 0.786, 9.5: 0.771, 9.0: 0.757, 8.5: 0.743, 8.0: 0.728, 7.5: 0.714, 7.0: 0.699, 6.5: 0.685, 6.0: 0.670 },
  9: { 10.0: 0.762, 9.5: 0.747, 9.0: 0.732, 8.5: 0.717, 8.0: 0.702, 7.5: 0.688, 7.0: 0.673, 6.5: 0.658, 6.0: 0.643 },
  10: { 10.0: 0.739, 9.5: 0.723, 9.0: 0.707, 8.5: 0.691, 8.0: 0.680, 7.5: 0.664, 7.0: 0.649, 6.5: 0.633, 6.0: 0.617 },
  11: { 10.0: 0.707, 9.5: 0.691, 9.0: 0.675, 8.5: 0.659, 8.0: 0.644, 7.5: 0.628, 7.0: 0.613, 6.5: 0.597, 6.0: 0.582 },
  12: { 10.0: 0.680, 9.5: 0.664, 9.0: 0.649, 8.5: 0.633, 8.0: 0.618, 7.5: 0.602, 7.0: 0.587, 6.5: 0.571, 6.0: 0.556 },
};

/**
 * Checks whether an RPE value is a valid finite number within the supported range [6.0, 10.0].
 * Rejects values outside 6.0 to 10.0 before any rounding occurs.
 */
export function isValidRPE(rpe: number | null | undefined): boolean {
  if (rpe === null || rpe === undefined) return false;
  if (typeof rpe !== 'number' || !Number.isFinite(rpe)) return false;
  return rpe >= 6.0 && rpe <= 10.0;
}

/**
 * Rounds a valid RPE value to the nearest 0.5 increment.
 */
export function roundRPEToHalfStep(rpe: number): number {
  return Math.round(rpe * 2) / 2;
}

/**
 * Looks up or calculates the percentage of 1RM multiplier for a given rep count and RPE.
 * 
 * Rules:
 * - Reps must be a finite positive integer (reps >= 1 and Number.isInteger(reps)).
 * - RPE must be valid (finite, between 6.0 and 10.0).
 * - For reps 1..12: exact matrix lookup.
 * - For reps > 12: RTS-anchored Epley extension:
 *     RIR = Math.max(0, 10.0 - roundedRPE)
 *     M12 = DEFAULT_RTS_STYLE_PERCENT_1RM[12][roundedRPE]
 *     Multiplier = M12 * ((30 + 12 + RIR) / (30 + reps + RIR))
 * - Returns null for invalid inputs.
 */
export function getRTSMultiplier(reps: number, rpe: number): number | null {
  if (!Number.isFinite(reps) || reps < 1 || !Number.isInteger(reps)) {
    return null;
  }
  if (!isValidRPE(rpe)) {
    return null;
  }

  const roundedRPE = roundRPEToHalfStep(rpe);

  if (reps <= 12) {
    const row = DEFAULT_RTS_STYLE_PERCENT_1RM[reps];
    if (!row) return null;
    const val = row[roundedRPE];
    return typeof val === 'number' ? val : null;
  }

  // Reps > 12: RTS-anchored Epley extension
  const m12 = DEFAULT_RTS_STYLE_PERCENT_1RM[12]?.[roundedRPE];
  if (typeof m12 !== 'number') return null;

  const rir = Math.max(0, 10.0 - roundedRPE);
  const multiplier = m12 * ((30 + 12 + rir) / (30 + reps + rir));
  return multiplier;
}

/**
 * Calculates estimated 1RM (e1RM) for an individual completed or planned set.
 * 
 * Rules:
 * - Weight must be finite and > 0.
 * - Reps must be a finite positive integer >= 1.
 * - With valid RPE (6.0..10.0): weight / getRTSMultiplier(reps, rpe).
 * - With missing RPE (null, undefined, 0): pure reps-only Epley: weight * (1 + reps / 30).
 * - With explicitly invalid RPE (outside 6.0..10.0 and not missing): returns null.
 * - Does not perform any 2.5 kg rounding or RPE 8.0 default substitutions.
 */
export function calculateE1RMForSet(
  weight: number,
  reps: number,
  rpe?: number | null
): number | null {
  if (!Number.isFinite(weight) || weight <= 0) {
    return null;
  }
  if (!Number.isFinite(reps) || reps < 1 || !Number.isInteger(reps)) {
    return null;
  }

  // Missing RPE case: null, undefined, or 0 -> Reps-only Epley
  if (rpe === null || rpe === undefined || rpe === 0) {
    return weight * (1 + reps / 30);
  }

  // Explicitly provided RPE must be valid
  if (!isValidRPE(rpe)) {
    return null;
  }

  const multiplier = getRTSMultiplier(reps, rpe);
  if (multiplier === null || multiplier <= 0) {
    return null;
  }

  return weight / multiplier;
}

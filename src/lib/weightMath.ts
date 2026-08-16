/**
 * Pure weight math utilities.
 * Provides rounding helpers without React or DOM dependencies.
 */

/**
 * Rounds a weight to the nearest specified increment (e.g. 2.5 kg or 5 lb).
 * If increment is invalid (<= 0 or non-finite), returns the unrounded weight.
 */
export function roundToNearestIncrement(weight: number, increment: number): number {
  if (!Number.isFinite(weight) || !Number.isFinite(increment) || increment <= 0) {
    return weight;
  }
  return Math.round(weight / increment) * increment;
}

/**
 * Rounds a weight to the nearest 2.5 kg increment.
 */
export function roundToNearest25(weight: number): number {
  return roundToNearestIncrement(weight, 2.5);
}

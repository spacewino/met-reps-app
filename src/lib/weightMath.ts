import type { WeightUnit } from '../types';

/**
 * Pure weight math utilities.
 * Provides rounding helpers without React or DOM dependencies.
 */

/**
 * Standard target-load rounding increment / quantum.
 * Determines displayable base and distributed set loads on the canonical 2.5-unit grid
 * for both metric (2.5 kg) and imperial (2.5 lb) weight units.
 *
 * NOTE: This is intentionally and deliberately separate from the Guided progression increment:
 * - Target-load rounding increment/quantum determines displayable base and distributed set loads (2.5 kg / 2.5 lb).
 * - Guided progression increment determines the relative change between progression steps
 *   (2.5 kg for metric, 5.0 lb for imperial weighted movements via `getWeightedIncrement`).
 */
export const TARGET_LOAD_ROUNDING_INCREMENT = 2.5;

/**
 * Resolves the explicit target-load rounding increment for a given weight unit.
 * Both 'kg' and 'lb' reside on the authorized 2.5-unit display and plate-quantum grid.
 */
export function getTargetLoadRoundingIncrement(_unit?: WeightUnit | string): number {
  return TARGET_LOAD_ROUNDING_INCREMENT;
}

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
 * Rounds a weight to the nearest 2.5-unit (kg or lb) increment.
 * Preserves the canonical 2.5-unit target-load rounding grid.
 */
export function roundToNearest25(weight: number): number {
  return roundToNearestIncrement(weight, TARGET_LOAD_ROUNDING_INCREMENT);
}


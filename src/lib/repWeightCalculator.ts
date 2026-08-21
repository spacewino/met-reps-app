/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { calculateE1RMForSet, getRTSMultiplier, isValidRPE } from './rpeMath';
import { roundToNearest25 } from './weightMath';

export const VALID_CALCULATOR_RPES: readonly number[] = [
  6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0,
] as const;

export const CALCULATOR_REP_PRESETS: readonly number[] = [
  1, 3, 5, 8, 10, 12, 15, 20,
] as const;

export interface CalculateEquivalentWeightInput {
  baseWeight: number | null | undefined;
  baseReps: number | null | undefined;
  baseRpe?: number | null;
  baseRPE?: number | null;
  targetReps: number;
  targetRpe?: number;
  targetRPE?: number;
}

export interface RepWeightCalculationResult {
  status: 'valid' | 'invalid';
  est1RM: number | null;
  rtsMultiplier: number | null;
  targetPercentage: number | null;
  targetWeight: number | null;
  errorReason?: string;
}

export interface SolveEquivalentRepsInput {
  baseWeight: number | null | undefined;
  baseReps: number | null | undefined;
  baseRPE?: number | null;
  baseRpe?: number | null;
  availableWeight: number | null | undefined;
  targetRPE?: number;
  targetRpe?: number;
  minReps?: number;
  maxReps?: number;
  unit?: string;
}

export type EquivalentRepsStatus = 'exact' | 'quantized' | 'constrained' | 'bypassed';

export interface SolveEquivalentRepsResult {
  status: EquivalentRepsStatus;
  baseE1RM: number | null;
  availableWeight: number | null;
  targetReps: number | null;
  targetRPE: number | null;
  achievedE1RM: number | null;
  capacityDiff: number | null;
  relativeError: number | null;
  unit?: string;
  constraintReason?: string;
  errorReason?: string;
}

/**
 * Determines whether the Rep & Weight Calculator is supported for a given exercise modality.
 * Currently, only weighted (and legacy unassigned) exercises are supported.
 */
export function isCalculatorSupportedForModality(
  modality?: string | null
): boolean {
  if (!modality || modality === 'weighted') {
    return true;
  }
  return false;
}

/**
 * Pure calculation function for converting a base set (weight, reps, optional RPE)
 * into an equivalent target working weight at specified target reps and target RPE.
 *
 * Uses canonical RTS e1RM and percentage lookups from rpeMath.ts and applies
 * 2.5-unit quantization strictly once to the final product.
 */
export function calculateEquivalentWorkingWeight(
  input: CalculateEquivalentWeightInput
): RepWeightCalculationResult {
  const baseWeight = input.baseWeight;
  const baseReps = input.baseReps;
  const baseRpe = input.baseRpe ?? input.baseRPE;
  const targetReps = input.targetReps;
  const targetRpe = input.targetRpe ?? input.targetRPE;

  // Validate base weight
  if (baseWeight === null || baseWeight === undefined || isNaN(baseWeight) || baseWeight <= 0) {
    return {
      status: 'invalid',
      est1RM: null,
      rtsMultiplier: null,
      targetPercentage: null,
      targetWeight: null,
      errorReason: 'Missing or invalid base weight',
    };
  }

  // Validate base reps (must be positive integer)
  if (
    baseReps === null ||
    baseReps === undefined ||
    isNaN(baseReps) ||
    !Number.isInteger(baseReps) ||
    baseReps <= 0
  ) {
    return {
      status: 'invalid',
      est1RM: null,
      rtsMultiplier: null,
      targetPercentage: null,
      targetWeight: null,
      errorReason: 'Missing or invalid base reps',
    };
  }

  // Validate target reps
  if (!Number.isInteger(targetReps) || targetReps <= 0) {
    return {
      status: 'invalid',
      est1RM: null,
      rtsMultiplier: null,
      targetPercentage: null,
      targetWeight: null,
      errorReason: 'Target reps must be a positive integer',
    };
  }

  // Validate target RPE
  if (targetRpe === undefined || targetRpe === null || !isValidRPE(targetRpe)) {
    return {
      status: 'invalid',
      est1RM: null,
      rtsMultiplier: null,
      targetPercentage: null,
      targetWeight: null,
      errorReason: 'Target RPE must be between 6.0 and 10.0 in 0.5 increments',
    };
  }

  // Calculate canonical est1RM using calculateE1RMForSet from rpeMath.
  // If baseRpe is null/undefined/0, calculateE1RMForSet automatically uses canonical reps-only Epley fallback.
  const est1RM = calculateE1RMForSet(baseWeight, baseReps, baseRpe ?? null);
  if (est1RM === null || isNaN(est1RM) || est1RM <= 0) {
    return {
      status: 'invalid',
      est1RM: null,
      rtsMultiplier: null,
      targetPercentage: null,
      targetWeight: null,
      errorReason: 'Unable to calculate estimated 1RM',
    };
  }

  // Get canonical RTS multiplier for target
  const rtsMultiplier = getRTSMultiplier(targetReps, targetRpe);
  if (rtsMultiplier === null || rtsMultiplier <= 0) {
    return {
      status: 'invalid',
      est1RM,
      rtsMultiplier: null,
      targetPercentage: null,
      targetWeight: null,
      errorReason: 'Invalid RTS percentage multiplier',
    };
  }

  // Final 2.5 unit quantization applied only once
  const unroundedTargetWeight = est1RM * rtsMultiplier;
  const targetWeight = roundToNearest25(unroundedTargetWeight);
  const targetPercentage = Math.round(rtsMultiplier * 100);

  return {
    status: 'valid',
    est1RM,
    rtsMultiplier,
    targetPercentage,
    targetWeight,
  };
}

/**
 * Pure inverse repetition solver that finds the integer repetition target (from minReps to maxReps)
 * that produces the closest estimated 1RM capacity for a given available weight and target RPE.
 *
 * Distinguishes:
 * - 'exact': Capacity difference is within tolerance (e.g. identical set parameters or exact table match).
 * - 'quantized': Interior integer rep count differs from exact capacity due to discrete integer reps.
 * - 'constrained': The ideal target capacity lies outside the 1–25 repetition boundary.
 * - 'bypassed': Invalid or missing required inputs.
 */
export function solveEquivalentRepetitions(
  input: SolveEquivalentRepsInput
): SolveEquivalentRepsResult {
  const baseWeight = input.baseWeight;
  const baseReps = input.baseReps;
  const baseRPE = input.baseRPE ?? input.baseRpe ?? null;
  const availableWeight = input.availableWeight;
  const targetRPE = input.targetRPE ?? input.targetRpe;
  const minReps = input.minReps ?? 1;
  const maxReps = input.maxReps ?? 25;
  const unit = input.unit;

  // Validate base weight
  if (baseWeight === null || baseWeight === undefined || isNaN(baseWeight) || baseWeight <= 0) {
    return {
      status: 'bypassed',
      baseE1RM: null,
      availableWeight: null,
      targetReps: null,
      targetRPE: null,
      achievedE1RM: null,
      capacityDiff: null,
      relativeError: null,
      unit,
      errorReason: 'Missing or invalid base weight',
    };
  }

  // Validate base reps (must be positive integer)
  if (
    baseReps === null ||
    baseReps === undefined ||
    isNaN(baseReps) ||
    !Number.isInteger(baseReps) ||
    baseReps <= 0
  ) {
    return {
      status: 'bypassed',
      baseE1RM: null,
      availableWeight: null,
      targetReps: null,
      targetRPE: null,
      achievedE1RM: null,
      capacityDiff: null,
      relativeError: null,
      unit,
      errorReason: 'Missing or invalid base reps',
    };
  }

  // Validate available weight
  if (
    availableWeight === null ||
    availableWeight === undefined ||
    isNaN(availableWeight) ||
    availableWeight <= 0
  ) {
    return {
      status: 'bypassed',
      baseE1RM: null,
      availableWeight: null,
      targetReps: null,
      targetRPE: null,
      achievedE1RM: null,
      capacityDiff: null,
      relativeError: null,
      unit,
      errorReason: 'Missing or invalid available weight',
    };
  }

  // Validate target RPE
  if (targetRPE === undefined || targetRPE === null || !isValidRPE(targetRPE)) {
    return {
      status: 'bypassed',
      baseE1RM: null,
      availableWeight,
      targetReps: null,
      targetRPE: null,
      achievedE1RM: null,
      capacityDiff: null,
      relativeError: null,
      unit,
      errorReason: 'Target RPE must be between 6.0 and 10.0 in 0.5 increments',
    };
  }

  // Validate rep bounds
  if (
    !Number.isInteger(minReps) ||
    !Number.isInteger(maxReps) ||
    minReps < 1 ||
    maxReps < minReps
  ) {
    return {
      status: 'bypassed',
      baseE1RM: null,
      availableWeight,
      targetReps: null,
      targetRPE,
      achievedE1RM: null,
      capacityDiff: null,
      relativeError: null,
      unit,
      errorReason: 'Invalid minReps or maxReps repetition bounds',
    };
  }

  // Canonical base estimated 1RM
  const baseE1RM = calculateE1RMForSet(baseWeight, baseReps, baseRPE);
  if (baseE1RM === null || isNaN(baseE1RM) || baseE1RM <= 0) {
    return {
      status: 'bypassed',
      baseE1RM: null,
      availableWeight,
      targetReps: null,
      targetRPE,
      achievedE1RM: null,
      capacityDiff: null,
      relativeError: null,
      unit,
      errorReason: 'Unable to calculate base estimated 1RM',
    };
  }

  // Ideal target multiplier
  const idealMultiplier = availableWeight / baseE1RM;
  const minBoundMultiplier = getRTSMultiplier(minReps, targetRPE);
  const maxBoundMultiplier = getRTSMultiplier(maxReps, targetRPE);

  let bestCandidate: {
    reps: number;
    multiplier: number;
    candE1RM: number;
    error: number;
    relErr: number;
  } | null = null;

  for (let r = minReps; r <= maxReps; r++) {
    const mult = getRTSMultiplier(r, targetRPE);
    if (mult === null || mult <= 0) continue;

    const candE1RM = availableWeight / mult;
    const error = Math.abs(candE1RM - baseE1RM);
    const relErr = error / baseE1RM;

    if (!bestCandidate) {
      bestCandidate = { reps: r, multiplier: mult, candE1RM, error, relErr };
    } else {
      const errorDiff = error - bestCandidate.error;
      if (errorDiff < -1e-7) {
        // Significantly smaller error
        bestCandidate = { reps: r, multiplier: mult, candE1RM, error, relErr };
      } else if (Math.abs(errorDiff) <= 1e-7) {
        // Tie-breaker 1: Closest to base repetitions count
        const distToOriginal = Math.abs(r - baseReps);
        const bestDistToOriginal = Math.abs(bestCandidate.reps - baseReps);

        if (distToOriginal < bestDistToOriginal) {
          bestCandidate = { reps: r, multiplier: mult, candE1RM, error, relErr };
        } else if (distToOriginal === bestDistToOriginal) {
          // Tie-breaker 2: Lower repetition count
          if (r < bestCandidate.reps) {
            bestCandidate = { reps: r, multiplier: mult, candE1RM, error, relErr };
          }
        }
      }
    }
  }

  if (!bestCandidate) {
    return {
      status: 'bypassed',
      baseE1RM,
      availableWeight,
      targetReps: null,
      targetRPE,
      achievedE1RM: null,
      capacityDiff: null,
      relativeError: null,
      unit,
      errorReason: 'No valid candidate found in repetition range',
    };
  }

  // Determine status (constrained vs exact vs quantized)
  let status: EquivalentRepsStatus = 'quantized';
  let constraintReason: string | undefined;

  if (minBoundMultiplier !== null && idealMultiplier > minBoundMultiplier + 1e-5) {
    status = 'constrained';
    constraintReason = `Available weight exceeds capacity for ${minReps} rep(s)`;
  } else if (maxBoundMultiplier !== null && idealMultiplier < maxBoundMultiplier - 1e-5) {
    status = 'constrained';
    constraintReason = `Available weight is lighter than capacity for ${maxReps} reps`;
  } else if (bestCandidate.error <= 0.001 || bestCandidate.relErr <= 0.0001) {
    status = 'exact';
  } else {
    status = 'quantized';
  }

  const capacityDiff = Math.round((bestCandidate.candE1RM - baseE1RM) * 1000) / 1000;

  return {
    status,
    baseE1RM,
    availableWeight,
    targetReps: bestCandidate.reps,
    targetRPE,
    achievedE1RM: bestCandidate.candE1RM,
    capacityDiff,
    relativeError: bestCandidate.relErr,
    unit,
    constraintReason,
  };
}

export interface ManualRepsValidationResult {
  isValid: boolean;
  value: number | null;
  errorReason?: string | null;
}

export interface ManualWeightValidationResult {
  isValid: boolean;
  value: number | null;
  errorReason?: string | null;
}

/**
 * Validates manual repetition entry for Find Weight mode.
 * Accepts whole integers between 1 and 25 (inclusive).
 * Rejects 0, negative, fractional, non-finite, and values above 25.
 */
export function validateManualRepsEntry(input: string | number | null | undefined): ManualRepsValidationResult {
  if (input === null || input === undefined) {
    return {
      isValid: false,
      value: null,
      errorReason: 'Enter a whole number from 1 to 25.',
    };
  }

  const str = String(input).trim();
  if (str === '') {
    return {
      isValid: false,
      value: null,
      errorReason: 'Enter a whole number from 1 to 25.',
    };
  }

  // Must be an integer without decimal point, minus sign, or non-numeric characters
  if (!/^\d+$/.test(str)) {
    return {
      isValid: false,
      value: null,
      errorReason: 'Enter a whole number from 1 to 25.',
    };
  }

  const num = parseInt(str, 10);
  if (isNaN(num) || !isFinite(num) || num < 1 || num > 25) {
    return {
      isValid: false,
      value: null,
      errorReason: 'Enter a whole number from 1 to 25.',
    };
  }

  return {
    isValid: true,
    value: num,
    errorReason: null,
  };
}

/**
 * Validates manual available weight entry for Find Reps mode.
 * Accepts any finite positive decimal number (> 0).
 * Rejects 0, negative, non-numeric, unfinished trailing decimal points, and empty strings.
 */
export function validateManualWeightEntry(input: string | number | null | undefined): ManualWeightValidationResult {
  if (input === null || input === undefined) {
    return {
      isValid: false,
      value: null,
      errorReason: 'Enter an available weight greater than 0.',
    };
  }

  const str = String(input).trim();
  if (str === '') {
    return {
      isValid: false,
      value: null,
      errorReason: 'Enter an available weight greater than 0.',
    };
  }

  // Must match a positive decimal or integer pattern (e.g. "9.1", "17.5", "22", "27.25")
  if (!/^[0-9]+(\.[0-9]+)?$/.test(str)) {
    return {
      isValid: false,
      value: null,
      errorReason: 'Enter an available weight greater than 0.',
    };
  }

  const num = parseFloat(str);
  if (isNaN(num) || !isFinite(num) || num <= 0) {
    return {
      isValid: false,
      value: null,
      errorReason: 'Enter an available weight greater than 0.',
    };
  }

  return {
    isValid: true,
    value: num,
    errorReason: null,
  };
}

/**
 * Adjusts repetition value by delta (clamped between 1 and 25).
 */
export function stepRepsValue(currentValue: number | string | null | undefined, delta: number): number {
  let val: number;
  if (typeof currentValue === 'number' && !isNaN(currentValue)) {
    val = currentValue;
  } else {
    const parsed = parseInt(String(currentValue).trim(), 10);
    val = isNaN(parsed) ? 10 : parsed;
  }
  const next = Math.round(val + delta);
  return Math.max(1, Math.min(25, next));
}

/**
 * Adjusts weight value by delta from the exact entered value.
 * Does not snap, quantize or round to 2.5 multiples.
 * (e.g. 9.1 + 2.5 = 11.6, 9.1 - 2.5 = 6.6)
 */
export function stepWeightValue(currentValue: number | string | null | undefined, delta: number): number {
  let val: number;
  if (typeof currentValue === 'number' && !isNaN(currentValue)) {
    val = currentValue;
  } else {
    const parsed = parseFloat(String(currentValue).trim());
    val = isNaN(parsed) ? 0 : parsed;
  }
  const next = Math.max(0, Math.round((val + delta) * 10000) / 10000);
  return next;
}

